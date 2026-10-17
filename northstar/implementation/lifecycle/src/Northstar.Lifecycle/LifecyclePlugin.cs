using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.ServiceModel;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;

namespace Northstar.Lifecycle
{
    // Runs before Dataverse adds audit, ownership, and state defaults.
    // Nested creates are deliberately unsupported until explicitly validated.
    public sealed class LifecycleCreateInputGuard : IPlugin
    {
        public const string Validated = "ns.lifecycle.create.input.v1";
        public void Execute(IServiceProvider provider)
        {
            var context = (IPluginExecutionContext)provider.GetService(typeof(IPluginExecutionContext));
            if (context.PrimaryEntityName != Contract.Table || context.MessageName != "Create" ||
                context.Stage != 10 || context.Mode != 0 || context.Depth != 1 ||
                context.ParentContext != null || context.UserId != context.InitiatingUserId)
                throw PrincipalConfiguration.Failure("NS_REGISTRATION");
            if (!(context.InputParameters.Contains("Target") &&
                context.InputParameters["Target"] is Entity target) || target.LogicalName != Contract.Table ||
                target.Attributes.Keys.Any(key => !new[] {
                    "ns_name", "ns_description", "ns_contact", "ns_requestid"
                }.Contains(key))) throw PrincipalConfiguration.Failure("NS_INVALID_INPUT");
            context.SharedVariables[Validated] = true;
        }
    }
    // Optional deployment-time identity-shape proof. It exposes only hashes of
    // the calling principal, never an identity value or a request record.
    public sealed class LifecyclePrincipalProbe : IPlugin
    {
        public void Execute(IServiceProvider provider)
        {
            var context = (IPluginExecutionContext)provider.GetService(typeof(IPluginExecutionContext));
            if (context.MessageName != "ns_VerifyLifecyclePrincipal" || context.Stage != 30 || context.Mode != 0 ||
                !context.IsInTransaction)
                throw PrincipalConfiguration.Failure("NS_REGISTRATION");
            var factory = (IOrganizationServiceFactory)provider.GetService(typeof(IOrganizationServiceFactory));
            var config = LifecyclePlugin.LoadConfiguration(factory.CreateOrganizationService(context.UserId));
            if (!config.PrincipalProbeEnabled || context.UserId == Guid.Empty ||
                context.UserId != context.InitiatingUserId ||
                (!config.IsPortal(context.UserId) && !config.IsOperator(context.UserId)))
                throw PrincipalConfiguration.Failure("NS_NOT_AUTHORIZED");
            context.OutputParameters["UserIdHash"] = Hash(context.UserId);
            context.OutputParameters["InitiatingUserIdHash"] = Hash(context.InitiatingUserId);
            context.OutputParameters["SamePrincipal"] = context.UserId == context.InitiatingUserId;
        }

        private static string Hash(Guid value)
        {
            using (var algorithm = SHA256.Create())
                return string.Concat(algorithm.ComputeHash(Encoding.UTF8.GetBytes(
                    value.ToString("D").ToLowerInvariant())).Select(b => b.ToString("x2", CultureInfo.InvariantCulture)));
        }
    }

    // Association messages have no per-table registration filter. The first
    // checks deliberately leave every unrelated relationship untouched.
    public sealed class LifecycleBoundaryGuard : IPlugin
    {
        public void Execute(IServiceProvider provider)
        {
            var context = (IPluginExecutionContext)provider.GetService(typeof(IPluginExecutionContext));
            if (context.MessageName == "Associate" || context.MessageName == "Disassociate")
            {
                if (!(context.InputParameters.Contains("Relationship") &&
                    context.InputParameters["Relationship"] is Relationship relationship) ||
                    relationship.SchemaName != "ns_contact_ns_request") return;
                if (context.Stage != 10 || context.Mode != 0)
                    throw PrincipalConfiguration.Failure("NS_REGISTRATION");
                // No supported lifecycle command changes or unlinks the contact.
                throw PrincipalConfiguration.Failure("NS_CONTACT_IMMUTABLE");
            }
            if (context.PrimaryEntityName != Contract.Table) return;
            // Create/Update pipelines merge with their bulk counterparts. A
            // blanket bulk denial would also reject ordinary single requests.
            if (new[] { "Upsert", "Assign", "SetState", "SetStateDynamicEntity" }.Contains(context.MessageName))
            {
                if (context.Stage != 10 || context.Mode != 0)
                    throw PrincipalConfiguration.Failure("NS_REGISTRATION");
                throw PrincipalConfiguration.Failure("NS_COMMAND_REQUIRED");
            }
        }
    }

    public static class Contract
    {
        public const string Table = "ns_request";
        public const string Edit = "ns_EditRequestDraft";
        public const string Submit = "ns_SubmitRequest";
        public const string Close = "ns_CloseRequest";
        public const string Configuration = "ns_LifecyclePrincipals";
        public const string Marker = "ns.lifecycle.command.v1";
        public const int Draft = 729100000;
        public const int Submitted = 729100001;
        public const int Closed = 729100002;
        public const int NotStarted = 729100000;
        public const int Pending = 729100001;
        public const int Completed = 729100002;
        public static readonly string[] ImageColumns = {
            "ns_name", "ns_description", "ns_contact", "ns_reference",
            "ns_publicstatus", "ns_submissionstatus", "ns_processingstate"
        };
        public static bool IsCommand(string name) =>
            name == Edit || name == Submit || name == Close;
    }

    [DataContract]
    public sealed class PrincipalConfiguration
    {
        [DataMember(Name = "portalPrincipalIds")]
        public string[] PortalPrincipalIds { get; set; }
        [DataMember(Name = "operatorPrincipalIds")]
        public string[] OperatorPrincipalIds { get; set; }
        [DataMember(Name = "principalProbeEnabled")]
        public bool PrincipalProbeEnabled { get; set; }

        public static PrincipalConfiguration Parse(string value)
        {
            try
            {
                using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(value)))
                {
                    var result = (PrincipalConfiguration)new DataContractJsonSerializer(
                        typeof(PrincipalConfiguration)).ReadObject(stream);
                    if (result == null || result.PortalPrincipalIds == null ||
                        result.OperatorPrincipalIds == null) throw Failure("NS_CONFIG");
                    var portal = ParseIds(result.PortalPrincipalIds);
                    var operators = ParseIds(result.OperatorPrincipalIds);
                    if (portal.Overlaps(operators)) throw Failure("NS_CONFIG");
                    return result;
                }
            }
            catch (InvalidPluginExecutionException) { throw; }
            catch { throw Failure("NS_CONFIG"); }
        }

        private static HashSet<Guid> ParseIds(string[] values)
        {
            var ids = new HashSet<Guid>();
            foreach (var value in values)
            {
                if (!Guid.TryParse(value, out var id) || id == Guid.Empty || !ids.Add(id))
                    throw Failure("NS_CONFIG");
            }
            return ids;
        }

        public bool IsPortal(Guid id) => ParseIds(PortalPrincipalIds).Contains(id);
        public bool IsOperator(Guid id) => ParseIds(OperatorPrincipalIds).Contains(id);
        internal static InvalidPluginExecutionException Failure(string code) =>
            new InvalidPluginExecutionException(code);
    }

    public sealed class LifecyclePlugin : IPlugin
    {
        public void Execute(IServiceProvider provider)
        {
            var context = (IPluginExecutionContext)provider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)provider.GetService(typeof(IOrganizationServiceFactory));
            var service = factory.CreateOrganizationService(context.UserId);
            try
            {
                if (Contract.IsCommand(context.MessageName)) ExecuteCommand(context, service);
                else ExecuteGuard(context, service);
            }
            catch (InvalidPluginExecutionException) { throw; }
            catch (FaultException<OrganizationServiceFault> fault)
            {
                // Preserve an actionable conflict without copying backend diagnostics.
                throw Fail(fault.Detail.ErrorCode == -2147088254 ? "NS_CONFLICT" : "NS_UNAVAILABLE");
            }
            catch { throw Fail("NS_UNAVAILABLE"); }
        }

        private static void ExecuteGuard(IPluginExecutionContext context, IOrganizationService service)
        {
            if (context.PrimaryEntityName != Contract.Table || context.Stage != 20 ||
                context.Mode != 0 || !context.IsInTransaction) throw Fail("NS_REGISTRATION");
            if (context.MessageName == "Delete") throw Fail("NS_DELETE_DENIED");
            if (!(context.InputParameters.Contains("Target") &&
                context.InputParameters["Target"] is Entity target) ||
                target.LogicalName != Contract.Table) throw Fail("NS_INVALID_INPUT");
            if (context.MessageName == "Create")
            {
                var validated = context.SharedVariables.Contains(LifecycleCreateInputGuard.Validated) &&
                    Equals(context.SharedVariables[LifecycleCreateInputGuard.Validated], true);
                var inputParent = context.ParentContext;
                if (!validated && inputParent != null && inputParent.MessageName == "Create" &&
                    inputParent.PrimaryEntityName == Contract.Table &&
                    inputParent.UserId == context.UserId &&
                    inputParent.InitiatingUserId == context.InitiatingUserId &&
                    inputParent.InputParameters.Contains("Target") &&
                    inputParent.InputParameters["Target"] is Entity inputTarget &&
                    inputTarget.LogicalName == Contract.Table &&
                    (inputTarget.Id == Guid.Empty || inputTarget.Id == target.Id) &&
                    inputParent.SharedVariables.Contains(LifecycleCreateInputGuard.Validated))
                    validated = Equals(inputParent.SharedVariables[LifecycleCreateInputGuard.Validated], true);
                if (!validated) throw Fail("NS_REGISTRATION");
                RequireOnly(target, "ns_name", "ns_description", "ns_contact", "ns_requestid",
                    "createdby", "createdon", "modifiedby", "modifiedon", "modifiedonbehalfby",
                    "ownerid", "owningbusinessunit", "owninguser", "statecode", "statuscode");
                foreach (var key in new[] { "createdby", "modifiedby", "ownerid", "owninguser" })
                    if (target.Contains(key) && (!(target[key] is EntityReference principal) ||
                        principal.LogicalName != "systemuser" || principal.Id != context.UserId))
                        throw Fail("NS_INVALID_INPUT");
                if (target.Contains("owningbusinessunit") &&
                    (!(target["owningbusinessunit"] is EntityReference unit) ||
                    unit.LogicalName != "businessunit" || unit.Id != context.BusinessUnitId))
                    throw Fail("NS_INVALID_INPUT");
                if (target.Contains("modifiedonbehalfby") && target["modifiedonbehalfby"] != null)
                    throw Fail("NS_INVALID_INPUT");
                if ((target.Contains("statecode") && target.GetAttributeValue<OptionSetValue>("statecode")?.Value != 0) ||
                    (target.Contains("statuscode") && target.GetAttributeValue<OptionSetValue>("statuscode")?.Value != 1))
                    throw Fail("NS_INVALID_INPUT");
                ValidateContent(target.GetAttributeValue<string>("ns_name"),
                    target.GetAttributeValue<string>("ns_description"));
                Contact(target);
                target["ns_name"] = target.GetAttributeValue<string>("ns_name").Trim();
                target["ns_description"] = target.GetAttributeValue<string>("ns_description").Trim();
                target["ns_reference"] = "NS-" + Guid.NewGuid().ToString("N").ToUpperInvariant();
                target["ns_submissionstatus"] = new OptionSetValue(Contract.Draft);
                target["ns_processingstate"] = new OptionSetValue(Contract.NotStarted);
                target["ns_publicstatus"] = "Draft";
                return;
            }
            if (context.MessageName != "Update") throw Fail("NS_REGISTRATION");
            if (!context.PreEntityImages.Contains("PreImage")) throw Fail("NS_REGISTRATION");
            var before = context.PreEntityImages["PreImage"];
            var parent = context.ParentContext;
            if (parent == null || !Contract.IsCommand(parent.MessageName) ||
                parent.InitiatingUserId != context.InitiatingUserId ||
                !parent.SharedVariables.Contains(Contract.Marker) ||
                !(parent.InputParameters.Contains("Target") &&
                  parent.InputParameters["Target"] is EntityReference parentTarget) ||
                parentTarget.LogicalName != Contract.Table || parentTarget.Id != target.Id ||
                !Equals(parent.SharedVariables[Contract.Marker], parent.MessageName + ":" + target.Id.ToString("D")))
                throw Fail("NS_COMMAND_REQUIRED");
            var config = LoadConfiguration(service);
            Authorize(parent, config, before);
            // Require the command's complete, derived patch, never arbitrary fields.
            var expected = DerivePatch(parent.MessageName, before,
                ReadOptionalString(parent, "Name"), ReadOptionalString(parent, "Description"));
            if (target.Attributes.Count != expected.Attributes.Count ||
                expected.Attributes.Any(item => !target.Contains(item.Key) ||
                    !SameValue(target[item.Key], item.Value))) throw Fail("NS_INVALID_INPUT");
        }

        private static void ExecuteCommand(IPluginExecutionContext context, IOrganizationService service)
        {
            if (context.Stage != 30 || context.Mode != 0 || !context.IsInTransaction)
                throw Fail("NS_REGISTRATION");
            if (!(context.InputParameters.Contains("Target") &&
                context.InputParameters["Target"] is EntityReference target) ||
                target.LogicalName != Contract.Table || target.Id == Guid.Empty)
                throw Fail("NS_INVALID_INPUT");
            var config = LoadConfiguration(service);
            AuthorizePrincipal(context, config);
            var expectedVersion = ReadRequiredString(context, "ExpectedRowVersion");
            if (expectedVersion.Length > 32 || expectedVersion.Any(c => c < '0' || c > '9'))
                throw Fail("NS_INVALID_INPUT");
            var before = service.Retrieve(Contract.Table, target.Id, new ColumnSet(Contract.ImageColumns));
            Authorize(context, config, before);
            if (string.IsNullOrEmpty(before.RowVersion) || before.RowVersion != expectedVersion)
                throw Fail("NS_CONFLICT");
            var patch = DerivePatch(context.MessageName, before,
                ReadOptionalString(context, "Name"), ReadOptionalString(context, "Description"));
            patch.Id = target.Id;
            patch.RowVersion = expectedVersion;
            context.SharedVariables[Contract.Marker] = context.MessageName + ":" + target.Id.ToString("D");
            service.Execute(new UpdateRequest {
                Target = patch,
                ConcurrencyBehavior = ConcurrencyBehavior.IfRowVersionMatches
            });
            context.OutputParameters["Status"] = context.MessageName == Contract.Edit ? "draft" :
                context.MessageName == Contract.Submit ? "submitted" : "closed";
        }

        private static void AuthorizePrincipal(IPluginExecutionContext context, PrincipalConfiguration config)
        {
            // IDs are Dataverse systemuser principals, not Entra app IDs/contact IDs.
            // A configured step running as another identity is rejected.
            if (context.UserId == Guid.Empty || context.UserId != context.InitiatingUserId)
                throw Fail("NS_NOT_AUTHORIZED");
            if (context.MessageName == Contract.Close)
            {
                if (!config.IsOperator(context.InitiatingUserId)) throw Fail("NS_NOT_AUTHORIZED");
            }
            else if (!config.IsPortal(context.InitiatingUserId)) throw Fail("NS_NOT_AUTHORIZED");
        }

        private static void Authorize(IPluginExecutionContext context, PrincipalConfiguration config, Entity before)
        {
            AuthorizePrincipal(context, config);
            if (context.MessageName == Contract.Close) return;
            if (!(context.InputParameters.Contains("CallerContact") &&
                context.InputParameters["CallerContact"] is Guid contact) ||
                contact == Guid.Empty || Contact(before) != contact) throw Fail("NS_NOT_AUTHORIZED");
        }

        internal static Entity DerivePatch(string command, Entity before, string title, string description)
        {
            foreach (var column in Contract.ImageColumns)
                if (!before.Contains(column)) throw Fail("NS_REGISTRATION");
            Contact(before);
            var state = before.GetAttributeValue<OptionSetValue>("ns_submissionstatus")?.Value;
            var patch = new Entity(Contract.Table);
            if (command == Contract.Edit)
            {
                if (state != Contract.Draft) throw Fail("NS_INVALID_STATE");
                ValidateContent(title, description);
                patch["ns_name"] = title.Trim();
                patch["ns_description"] = description.Trim();
            }
            else if (command == Contract.Submit)
            {
                if (state != Contract.Draft) throw Fail("NS_INVALID_STATE");
                ValidateContent(before.GetAttributeValue<string>("ns_name"),
                    before.GetAttributeValue<string>("ns_description"));
                if (string.IsNullOrWhiteSpace(before.GetAttributeValue<string>("ns_reference")))
                    throw Fail("NS_INVALID_STATE");
                patch["ns_submissionstatus"] = new OptionSetValue(Contract.Submitted);
                patch["ns_processingstate"] = new OptionSetValue(Contract.Pending);
                patch["ns_publicstatus"] = "Submitted";
            }
            else if (command == Contract.Close)
            {
                if (state != Contract.Submitted) throw Fail("NS_INVALID_STATE");
                patch["ns_submissionstatus"] = new OptionSetValue(Contract.Closed);
                patch["ns_processingstate"] = new OptionSetValue(Contract.Completed);
                patch["ns_publicstatus"] = "Closed";
            }
            else throw Fail("NS_INVALID_INPUT");
            return patch;
        }

        internal static PrincipalConfiguration LoadConfiguration(IOrganizationService service)
        {
            var definition = new QueryExpression("environmentvariabledefinition") {
                ColumnSet = new ColumnSet("environmentvariabledefinitionid")
            };
            definition.Criteria.AddCondition("schemaname", ConditionOperator.Equal, Contract.Configuration);
            var definitions = service.RetrieveMultiple(definition).Entities;
            if (definitions.Count != 1) throw Fail("NS_CONFIG");
            var valuesQuery = new QueryExpression("environmentvariablevalue") {
                ColumnSet = new ColumnSet("value")
            };
            valuesQuery.Criteria.AddCondition("environmentvariabledefinitionid", ConditionOperator.Equal, definitions[0].Id);
            valuesQuery.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);
            var values = service.RetrieveMultiple(valuesQuery).Entities;
            if (values.Count != 1 || string.IsNullOrWhiteSpace(values[0].GetAttributeValue<string>("value")))
                throw Fail("NS_CONFIG");
            return PrincipalConfiguration.Parse(values[0].GetAttributeValue<string>("value"));
        }

        private static Guid Contact(Entity entity)
        {
            var contact = entity.GetAttributeValue<EntityReference>("ns_contact");
            if (contact == null || contact.LogicalName != "contact" || contact.Id == Guid.Empty)
                throw Fail("NS_INVALID_INPUT");
            return contact.Id;
        }

        private static void ValidateContent(string title, string description)
        {
            if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 200 ||
                string.IsNullOrWhiteSpace(description) || description.Trim().Length > 4000)
                throw Fail("NS_INVALID_INPUT");
        }

        private static string ReadRequiredString(IPluginExecutionContext context, string name)
        {
            var value = ReadOptionalString(context, name);
            if (string.IsNullOrEmpty(value)) throw Fail("NS_INVALID_INPUT");
            return value;
        }

        private static string ReadOptionalString(IPluginExecutionContext context, string name)
        {
            if (!context.InputParameters.Contains(name)) return null;
            if (!(context.InputParameters[name] is string text)) throw Fail("NS_INVALID_INPUT");
            return text;
        }

        private static void RequireOnly(Entity entity, params string[] allowed)
        {
            if (entity.Attributes.Keys.Any(key => !allowed.Contains(key))) throw Fail("NS_INVALID_INPUT");
        }

        private static bool SameValue(object left, object right) =>
            left is OptionSetValue first && right is OptionSetValue second ? first.Value == second.Value : Equals(left, right);

        private static InvalidPluginExecutionException Fail(string code) =>
            PrincipalConfiguration.Failure(code);
    }
}

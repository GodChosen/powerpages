using System.Reflection;
using System.ServiceModel;
using System.Text.Json;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;
using Northstar.Lifecycle;

public class InterfaceProxy : DispatchProxy
{
    public Func<MethodInfo, object[], object> InvokeHandler;
    protected override object Invoke(MethodInfo method, object[] args) => InvokeHandler(method, args);
    public static T Build<T>(Func<MethodInfo, object[], object> callback) where T : class
    {
        var proxy = Create<T, InterfaceProxy>();
        ((InterfaceProxy)(object)proxy).InvokeHandler = callback;
        return proxy;
    }
}

public sealed class Context
{
    public readonly Dictionary<string, object> Values = new();
    public IPluginExecutionContext Value;
    public readonly ParameterCollection Input = new();
    public readonly ParameterCollection Output = new();
    public readonly ParameterCollection Shared = new();
    public readonly EntityImageCollection Images = new();
    public Context(string message, Guid caller, int stage, string table = Contract.Table)
    {
        Values["MessageName"] = message;
        Values["UserId"] = caller;
        Values["InitiatingUserId"] = caller;
        Values["PrimaryEntityName"] = table;
        Values["Stage"] = stage;
        Values["Mode"] = 0;
        Values["Depth"] = stage == 30 ? 1 : 2;
        Values["IsInTransaction"] = true;
        Values["InputParameters"] = Input;
        Values["OutputParameters"] = Output;
        Values["SharedVariables"] = Shared;
        Values["PreEntityImages"] = Images;
        Value = InterfaceProxy.Build<IPluginExecutionContext>((method, _) => {
            var key = method.Name.Replace("get_", "");
            return Values.TryGetValue(key, out var value) ? value :
                method.ReturnType.IsValueType ? Activator.CreateInstance(method.ReturnType) : null;
        });
    }
}

public sealed class Provider : IServiceProvider
{
    public Context Context;
    public IOrganizationService Service;
    public object GetService(Type type) => type == typeof(IPluginExecutionContext) ? Context.Value :
        type == typeof(IOrganizationServiceFactory) ?
        InterfaceProxy.Build<IOrganizationServiceFactory>((_, _) => Service) : null;
}

public sealed class Lab
{
    public static readonly Guid Portal = Guid.Parse("10000000-0000-0000-0000-000000000001");
    public static readonly Guid Operator = Guid.Parse("10000000-0000-0000-0000-000000000002");
    public static readonly Guid Alice = Guid.Parse("20000000-0000-0000-0000-000000000001");
    public static readonly Guid Ben = Guid.Parse("20000000-0000-0000-0000-000000000002");
    public Entity Row = Snapshot();
    public string Configuration = "{\"portalPrincipalIds\":[\"" + Portal +
        "\"],\"operatorPrincipalIds\":[\"" + Operator + "\"]}";
    public int DefinitionCount = 1;
    public int ValueCount = 1;
    public int Updates;
    public int Retrieves;
    public bool SimulateRace;
    public UpdateRequest LastUpdate;
    public Context Current;
    public readonly IOrganizationService Service;
    public Lab()
    {
        Service = InterfaceProxy.Build<IOrganizationService>((method, args) => {
            if (method.Name == "RetrieveMultiple") {
                var query = (QueryExpression)args[0];
                var collection = new EntityCollection();
                var count = query.EntityName == "environmentvariabledefinition" ? DefinitionCount : ValueCount;
                for (var i = 0; i < count; i++) {
                    var entity = new Entity(query.EntityName, Guid.NewGuid());
                    if (query.EntityName == "environmentvariablevalue") entity["value"] = Configuration;
                    collection.Entities.Add(entity);
                }
                return collection;
            }
            if (method.Name == "Retrieve") { Retrieves++; return Copy(Row); }
            if (method.Name == "Execute") {
                var update = (UpdateRequest)args[0];
                LastUpdate = update;
                if (update.ConcurrencyBehavior != ConcurrencyBehavior.IfRowVersionMatches)
                    throw new Exception("Missing optimistic concurrency request.");
                if (SimulateRace || update.Target.RowVersion != Row.RowVersion)
                    throw new FaultException<OrganizationServiceFault>(
                        new OrganizationServiceFault { ErrorCode = -2147088254, Message = "PRIVATE BACKEND DETAIL" });
                var child = new Context("Update", Current.Value.UserId, 20);
                child.Values["ParentContext"] = Current.Value;
                child.Input["Target"] = update.Target;
                child.Images["PreImage"] = Copy(Row);
                Execute(child);
                foreach (var pair in update.Target.Attributes) Row[pair.Key] = pair.Value;
                Row.RowVersion = (long.Parse(Row.RowVersion) + 1).ToString();
                Updates++;
                return new UpdateResponse();
            }
            throw new Exception("Unexpected organization service call: " + method.Name);
        });
    }
    public void Execute(Context context) => new LifecyclePlugin().Execute(new Provider { Context = context, Service = Service });
    public Context Command(string name, Guid? caller = null, Guid? contact = null, string version = "7")
    {
        Current = new Context(name, caller ?? Portal, 30);
        Current.Input["Target"] = Row.ToEntityReference();
        Current.Input["ExpectedRowVersion"] = version;
        if (name != Contract.Close) Current.Input["CallerContact"] = contact ?? Alice;
        if (name == Contract.Edit) { Current.Input["Name"] = " Edited "; Current.Input["Description"] = " Detail "; }
        return Current;
    }
    public static Entity Snapshot(int state = Contract.Draft) => new(Contract.Table, Guid.Parse("30000000-0000-0000-0000-000000000001")) {
        RowVersion = "7",
        ["ns_name"] = "Title", ["ns_description"] = "Description",
        ["ns_reference"] = "NS-SYNTHETIC", ["ns_publicstatus"] = "Draft",
        ["ns_contact"] = new EntityReference("contact", Alice),
        ["ns_submissionstatus"] = new OptionSetValue(state),
        ["ns_processingstate"] = new OptionSetValue(Contract.NotStarted)
    };
    public static Entity Copy(Entity source)
    {
        var copy = new Entity(source.LogicalName, source.Id) { RowVersion = source.RowVersion };
        foreach (var pair in source.Attributes) copy[pair.Key] = pair.Value;
        return copy;
    }
}

public static class Program
{
    private static readonly List<object> Results = new();
    private static void Check(bool condition) { if (!condition) throw new Exception("Assertion failed."); }
    private static void Test(string name, Action action)
    {
        try { action(); Results.Add(new { name, status = "PASS" }); }
        catch (Exception error) { Results.Add(new { name, status = "FAIL", error = error.Message }); }
    }
    private static void Deny(Action action, string expected)
    {
        try { action(); throw new Exception("Expected rejection."); }
        catch (InvalidPluginExecutionException error) { Check(error.Message == expected); }
    }
    private static Entity CreateTarget() => new(Contract.Table) {
        ["ns_name"] = " Title ", ["ns_description"] = " Detail ",
        ["ns_contact"] = new EntityReference("contact", Lab.Alice)
    };
    private static Context CreateContext(Entity target) {
        var context = new Context("Create", Lab.Portal, 20);
        var input = new Context("Create", Lab.Portal, 10);
        input.Values["Depth"] = 1;
        input.Input["Target"] = target;
        new LifecycleCreateInputGuard().Execute(new Provider { Context = input });
        context.Shared[LifecycleCreateInputGuard.Validated] = input.Shared[LifecycleCreateInputGuard.Validated];
        context.Input["Target"] = target; return context;
    }
    public static int Main()
    {
        foreach (var field in new[] { "ownerid", "statecode", "statuscode", "createdon", "createdby" })
            Test("PreValidation rejects injected platform field " + field, () => {
                var target = CreateTarget(); target[field] = "forged";
                Deny(() => CreateContext(target), "NS_INVALID_INPUT");
            });
        Test("Create without PreValidation proof fails closed", () => {
            var context = new Context("Create", Lab.Portal, 20);
            context.Input["Target"] = CreateTarget();
            Deny(() => new Lab().Execute(context), "NS_REGISTRATION");
        });
        Test("Create accepts actual stage30 parent carrying PreValidation proof", () => {
            var target = CreateTarget();
            var parent = new Context("Create", Lab.Portal, 30);
            parent.Input["Target"] = target;
            parent.Shared[LifecycleCreateInputGuard.Validated] = true;
            var context = new Context("Create", Lab.Portal, 20);
            context.Input["Target"] = target;
            context.Values["ParentContext"] = parent.Value;
            new Lab().Execute(context);
            Check(target.GetAttributeValue<OptionSetValue>("ns_submissionstatus").Value == Contract.Draft);
        });
        Test("Create cannot reuse parent proof for a different nonempty record ID", () => {
            var target = CreateTarget(); target.Id = Guid.NewGuid();
            var parent = new Context("Create", Lab.Portal, 30);
            parent.Input["Target"] = new Entity(Contract.Table, Guid.NewGuid());
            parent.Shared[LifecycleCreateInputGuard.Validated] = true;
            var context = new Context("Create", Lab.Portal, 20);
            context.Input["Target"] = target;
            context.Values["ParentContext"] = parent.Value;
            Deny(() => new Lab().Execute(context), "NS_REGISTRATION");
        });
        Test("Create permits platform-owned defaults after payload validation", () => {
            var context = CreateContext(CreateTarget());
            var target = (Entity)context.Input["Target"];
            target["ownerid"] = new EntityReference("systemuser", Lab.Portal);
            target["statecode"] = new OptionSetValue(0);
            target["statuscode"] = new OptionSetValue(1);
            new Lab().Execute(context);
            Check(target.GetAttributeValue<OptionSetValue>("ns_submissionstatus").Value == Contract.Draft);
        });
        Test("Create rejects substituted ownership after payload validation", () => {
            var context = CreateContext(CreateTarget());
            ((Entity)context.Input["Target"])["ownerid"] = new EntityReference("systemuser", Lab.Operator);
            Deny(() => new Lab().Execute(context), "NS_INVALID_INPUT");
        });
        Test("Nested Create is unsupported and fails closed", () => {
            var context = new Context("Create", Lab.Portal, 10);
            context.Input["Target"] = CreateTarget();
            Deny(() => new LifecycleCreateInputGuard().Execute(new Provider { Context = context }), "NS_REGISTRATION");
        });
        Test("Create assigns draft defaults and opaque reference atomically on target", () => {
            var target = CreateTarget(); new Lab().Execute(CreateContext(target));
            Check(target.GetAttributeValue<OptionSetValue>("ns_submissionstatus").Value == Contract.Draft);
            Check(target.GetAttributeValue<OptionSetValue>("ns_processingstate").Value == Contract.NotStarted);
            Check(target.GetAttributeValue<string>("ns_name") == "Title");
            Check(target.GetAttributeValue<string>("ns_publicstatus") == "Draft");
            Check(target.GetAttributeValue<string>("ns_reference").StartsWith("NS-"));
        });
        foreach (var column in new[] { "ns_submissionstatus", "ns_processingstate", "ns_reference", "ownerid", "createdon", "ns_publicstatus", "unexpected" })
            Test("Create rejects caller-controlled " + column, () => {
                var target = CreateTarget(); target[column] = "forbidden";
                Deny(() => new Lab().Execute(CreateContext(target)), "NS_INVALID_INPUT");
            });
        foreach (var title in new[] { "", " ", new string('a', 201) })
            Test("Create rejects invalid title length " + title.Length, () => {
                var target = CreateTarget(); target["ns_name"] = title;
                Deny(() => new Lab().Execute(CreateContext(target)), "NS_INVALID_INPUT");
            });
        Test("Create rejects overlong description", () => {
            var target = CreateTarget(); target["ns_description"] = new string('a', 4001);
            Deny(() => new Lab().Execute(CreateContext(target)), "NS_INVALID_INPUT");
        });
        Test("Create rejects absent contact", () => {
            var target = CreateTarget(); target.Attributes.Remove("ns_contact");
            Deny(() => new Lab().Execute(CreateContext(target)), "NS_INVALID_INPUT");
        });
        Test("Create rejects wrong lookup type", () => {
            var target = CreateTarget(); target["ns_contact"] = new EntityReference("systemuser", Lab.Alice);
            Deny(() => new Lab().Execute(CreateContext(target)), "NS_INVALID_INPUT");
        });
        Test("Direct Update cannot bypass lifecycle commands", () => {
            var lab = new Lab(); var context = new Context("Update", Lab.Operator, 20);
            context.Input["Target"] = new Entity(Contract.Table, lab.Row.Id) { ["ns_name"] = "Bypass" };
            context.Images["PreImage"] = lab.Row;
            Deny(() => lab.Execute(context), "NS_COMMAND_REQUIRED");
        });
        Test("Delete rejected even for configured operator", () => {
            Deny(() => new Lab().Execute(new Context("Delete", Lab.Operator, 20)), "NS_DELETE_DENIED");
        });
        Test("Edit draft traverses command and nested guard using row version", () => {
            var lab = new Lab(); var context = lab.Command(Contract.Edit); lab.Execute(context);
            Check(lab.Updates == 1 && lab.Row.GetAttributeValue<string>("ns_name") == "Edited");
            Check(context.Output["Status"].Equals("draft"));
            Check(lab.LastUpdate.Target.RowVersion == "7");
        });
        Test("Submit traverses command and guard with fixed derived fields", () => {
            var lab = new Lab(); var context = lab.Command(Contract.Submit); lab.Execute(context);
            Check(lab.Updates == 1 && context.Output["Status"].Equals("submitted"));
            Check(lab.Row.GetAttributeValue<OptionSetValue>("ns_submissionstatus").Value == Contract.Submitted);
        });
        Test("Operator closes only a submitted request", () => {
            var lab = new Lab { Row = Lab.Snapshot(Contract.Submitted) };
            var context = lab.Command(Contract.Close, Lab.Operator); lab.Execute(context);
            Check(lab.Updates == 1 && context.Output["Status"].Equals("closed"));
        });
        foreach (var command in new[] { Contract.Edit, Contract.Submit }) {
            Test(command + " rejects another contact before update", () => {
                var lab = new Lab(); var context = lab.Command(command, contact: Lab.Ben);
                Deny(() => lab.Execute(context), "NS_NOT_AUTHORIZED"); Check(lab.Updates == 0);
            });
            Test(command + " rejects unapproved principal before retrieve", () => {
                var lab = new Lab(); var context = lab.Command(command, Guid.NewGuid());
                Deny(() => lab.Execute(context), "NS_NOT_AUTHORIZED"); Check(lab.Retrieves == 0);
            });
            foreach (var state in new[] { Contract.Submitted, Contract.Closed })
                Test(command + " rejects non-draft " + state, () => {
                    var lab = new Lab { Row = Lab.Snapshot(state) }; var context = lab.Command(command);
                    Deny(() => lab.Execute(context), "NS_INVALID_STATE"); Check(lab.Updates == 0);
                });
        }
        Test("Portal cannot execute operator close", () => {
            var lab = new Lab { Row = Lab.Snapshot(Contract.Submitted) }; var context = lab.Command(Contract.Close);
            Deny(() => lab.Execute(context), "NS_NOT_AUTHORIZED"); Check(lab.Retrieves == 0);
        });
        Test("Operator cannot impersonate customer submission", () => {
            var lab = new Lab(); var context = lab.Command(Contract.Submit, Lab.Operator);
            Deny(() => lab.Execute(context), "NS_NOT_AUTHORIZED");
        });
        Test("Run-as impersonation rejected", () => {
            var lab = new Lab(); var context = lab.Command(Contract.Submit);
            context.Values["UserId"] = Lab.Operator;
            Deny(() => lab.Execute(context), "NS_NOT_AUTHORIZED");
        });
        foreach (var version in new[] { "", "abc", "6", new string('1', 33) })
            Test("Invalid or stale row version rejected: " + version.Length, () => {
                var lab = new Lab(); var context = lab.Command(Contract.Submit, version: version);
                Deny(() => lab.Execute(context), version == "6" ? "NS_CONFLICT" : "NS_INVALID_INPUT");
                Check(lab.Updates == 0);
            });
        Test("Concurrency fault after read is normalized and not retried", () => {
            var lab = new Lab { SimulateRace = true }; var context = lab.Command(Contract.Submit);
            Deny(() => lab.Execute(context), "NS_CONFLICT"); Check(lab.Updates == 0);
        });
        foreach (var config in new[] { "{}", "bad json", "{\"portalPrincipalIds\":[],\"operatorPrincipalIds\":[\"bad\"]}",
            "{\"portalPrincipalIds\":[\"" + Lab.Portal + "\"],\"operatorPrincipalIds\":[\"" + Lab.Portal + "\"]}" })
            Test("Invalid principal configuration fails closed " + config.Length, () => {
                var lab = new Lab { Configuration = config }; var context = lab.Command(Contract.Submit);
                Deny(() => lab.Execute(context), "NS_CONFIG"); Check(lab.Updates == 0);
            });
        foreach (var count in new[] { 0, 2 }) {
            Test("Missing/ambiguous environment definition fails closed " + count, () => {
                var lab = new Lab { DefinitionCount = count }; var context = lab.Command(Contract.Submit);
                Deny(() => lab.Execute(context), "NS_CONFIG");
            });
            Test("Missing/ambiguous environment value fails closed " + count, () => {
                var lab = new Lab { ValueCount = count }; var context = lab.Command(Contract.Submit);
                Deny(() => lab.Execute(context), "NS_CONFIG");
            });
        }
        Test("Pre-image omission cannot silently bypass guard", () => {
            var lab = new Lab(); var context = new Context("Update", Lab.Portal, 20);
            context.Input["Target"] = new Entity(Contract.Table, lab.Row.Id);
            Deny(() => lab.Execute(context), "NS_REGISTRATION");
        });
        Test("Nontransaction registration fails closed", () => {
            var lab = new Lab(); var context = lab.Command(Contract.Submit); context.Values["IsInTransaction"] = false;
            Deny(() => lab.Execute(context), "NS_REGISTRATION");
        });
        Test("Unrelated table registration cannot act", () => {
            var lab = new Lab(); var context = CreateContext(CreateTarget()); context.Values["PrimaryEntityName"] = "contact";
            Deny(() => lab.Execute(context), "NS_REGISTRATION");
        });
        foreach (var message in new[] { "Associate", "Disassociate" }) {
            Test(message + " contact relationship cannot bypass Update guard", () => {
                var lab = new Lab(); var context = new Context(message, Lab.Operator, 10, "contact");
                context.Input["Relationship"] = new Relationship("ns_contact_ns_request");
                Deny(() => new LifecycleBoundaryGuard().Execute(new Provider { Context = context, Service = lab.Service }),
                    "NS_CONTACT_IMMUTABLE");
            });
            Test(message + " leaves unrelated relationships unchanged", () => {
                var context = new Context(message, Lab.Operator, 10, "contact");
                context.Input["Relationship"] = new Relationship("unrelated_relationship");
                new LifecycleBoundaryGuard().Execute(new Provider { Context = context });
            });
        }
        foreach (var message in new[] { "Upsert", "Assign", "SetState", "SetStateDynamicEntity" }) {
            Test(message + " unsupported lab route fails closed", () => {
                var context = new Context(message, Lab.Operator, 10);
                Deny(() => new LifecycleBoundaryGuard().Execute(new Provider { Context = context }), "NS_COMMAND_REQUIRED");
            });
            Test(message + " leaves unrelated tables unchanged", () => {
                var context = new Context(message, Lab.Operator, 10, "contact");
                new LifecycleBoundaryGuard().Execute(new Provider { Context = context });
            });
        }
        Test("Correct maximum editable text lengths succeed", () => {
            var lab = new Lab(); var context = lab.Command(Contract.Edit);
            context.Input["Name"] = new string('n', 200); context.Input["Description"] = new string('d', 4000);
            lab.Execute(context); Check(lab.Updates == 1);
        });
        foreach (var state in new[] { Contract.Draft, Contract.Closed })
            Test("Close rejects invalid source state " + state, () => {
                var lab = new Lab { Row = Lab.Snapshot(state) }; var context = lab.Command(Contract.Close, Lab.Operator);
                Deny(() => lab.Execute(context), "NS_INVALID_STATE");
            });
        Test("Shared marker alone cannot authenticate direct update", () => {
            var lab = new Lab(); var context = new Context("Update", Lab.Portal, 20);
            context.Input["Target"] = new Entity(Contract.Table, lab.Row.Id) { ["ns_name"] = "Attack" };
            context.Images["PreImage"] = lab.Row; context.Shared[Contract.Marker] = Contract.Edit + ":" + lab.Row.Id;
            Deny(() => lab.Execute(context), "NS_COMMAND_REQUIRED");
        });
        Test("Trusted command marker cannot authorize a different record", () => {
            var lab = new Lab(); var parent = lab.Command(Contract.Edit);
            parent.Shared[Contract.Marker] = Contract.Edit + ":" + lab.Row.Id;
            var child = new Context("Update", Lab.Portal, 20);
            child.Values["ParentContext"] = parent.Value; child.Images["PreImage"] = lab.Row;
            child.Input["Target"] = new Entity(Contract.Table, Guid.NewGuid()) { ["ns_name"] = "Attack" };
            Deny(() => lab.Execute(child), "NS_COMMAND_REQUIRED");
        });
        Test("Trusted command cannot smuggle immutable contact into update", () => {
            var lab = new Lab(); var parent = lab.Command(Contract.Edit);
            parent.Shared[Contract.Marker] = Contract.Edit + ":" + lab.Row.Id;
            var child = new Context("Update", Lab.Portal, 20);
            child.Values["ParentContext"] = parent.Value; child.Images["PreImage"] = lab.Row;
            child.Input["Target"] = new Entity(Contract.Table, lab.Row.Id) {
                ["ns_name"] = "Edited", ["ns_description"] = "Detail",
                ["ns_contact"] = new EntityReference("contact", Lab.Ben)
            };
            Deny(() => lab.Execute(child), "NS_INVALID_INPUT");
        });
        Test("Replay with new version cannot resubmit an accepted request", () => {
            var lab = new Lab(); lab.Execute(lab.Command(Contract.Submit));
            var replay = lab.Command(Contract.Submit, version: "8");
            Deny(() => lab.Execute(replay), "NS_INVALID_STATE"); Check(lab.Updates == 1);
        });
        Test("Optional principal proof exposes hashes only and performs no data calls", () => {
            var lab = new Lab(); lab.Configuration = lab.Configuration.Replace("}", ",\"principalProbeEnabled\":true}");
            var context = new Context("ns_VerifyLifecyclePrincipal", Lab.Portal, 30, "none");
            new LifecyclePrincipalProbe().Execute(new Provider { Context = context, Service = lab.Service });
            Check(context.Output.Count == 3);
            Check(((string)context.Output["UserIdHash"]).Length == 64);
            Check(context.Output["UserIdHash"].Equals(context.Output["InitiatingUserIdHash"]));
            Check(context.Output["SamePrincipal"].Equals(true));
            Check(lab.Retrieves == 0 && lab.Updates == 0);
        });
        Test("Principal proof disabled by default", () => {
            var lab = new Lab(); var context = new Context("ns_VerifyLifecyclePrincipal", Lab.Portal, 30, "none");
            Deny(() => new LifecyclePrincipalProbe().Execute(new Provider { Context = context, Service = lab.Service }),
                "NS_NOT_AUTHORIZED");
        });
        Test("Principal proof rejects unconfigured caller", () => {
            var lab = new Lab(); lab.Configuration = lab.Configuration.Replace("}", ",\"principalProbeEnabled\":true}");
            var context = new Context("ns_VerifyLifecyclePrincipal", Guid.NewGuid(), 30, "none");
            Deny(() => new LifecyclePrincipalProbe().Execute(new Provider { Context = context, Service = lab.Service }),
                "NS_NOT_AUTHORIZED");
        });
        var report = new { scope = "Local SDK-interface fakes, not a Dataverse transaction emulator or tenant validation", results = Results };
        var json = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
        Directory.CreateDirectory("evidence"); File.WriteAllText("evidence/lifecycle-local-tests.json", json);
        Console.WriteLine(json);
        return Results.Any(result => result.GetType().GetProperty("status").GetValue(result).Equals("FAIL")) ? 1 : 0;
    }
}

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    private const int DefaultPollIntervalMs = 1500;
    private const int APPMODEL_ERROR_NO_PACKAGE = 15700;

    private static readonly HashSet<uint> SeenNotificationIds = new HashSet<uint>();
    private static readonly AutoResetEvent SyncSignal = new AutoResetEvent(false);
    private static readonly MethodInfo AsTaskMethod = typeof(System.WindowsRuntimeSystemExtensions)
        .GetMethods(BindingFlags.Public | BindingFlags.Static)
        .First(method => method.Name == "AsTask" && method.IsGenericMethod && method.GetParameters().Length == 1);

    private static readonly Type ListenerType = Type.GetType(
        "Windows.UI.Notifications.Management.UserNotificationListener, Windows, ContentType=WindowsRuntime",
        true
    );

    private static readonly Type NotificationKindsType = Type.GetType(
        "Windows.UI.Notifications.NotificationKinds, Windows, ContentType=WindowsRuntime",
        true
    );

    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);

        try
        {
            var options = ParseOptions(args);
            var allowList = BuildAllowList(options.SourceAllowList);
            var listener = ListenerType.GetProperty("Current", BindingFlags.Public | BindingFlags.Static).GetValue(null, null);
            var requestAccessMethod = ListenerType.GetMethod("RequestAccessAsync", BindingFlags.Public | BindingFlags.Instance);
            var accessOperation = requestAccessMethod.Invoke(listener, null);
            var accessStatus = AwaitWinRtOperation(accessOperation, requestAccessMethod.ReturnType);

            if (!string.Equals(accessStatus.ToString(), "Allowed", StringComparison.OrdinalIgnoreCase))
            {
                WriteError(string.Format("[toast-listener] UserNotificationListener access not allowed: {0}", accessStatus));
                return 1;
            }

            var baselineCount = InitializeBaseline(listener);
            var eventSubscribed = TrySubscribeNotificationChanged(listener);
            WriteError(
                string.Format(
                    "[toast-listener] ready; allowed sources: {0}; baseline={1}; mode={2}; poll={3} ms",
                    string.Join(", ", allowList.OrderBy(item => item)),
                    baselineCount,
                    eventSubscribed ? "foreground-event" : "poll-only",
                    options.PollIntervalMs
                )
            );

            if (options.ExitAfterInit)
            {
                return 0;
            }

            while (true)
            {
                try
                {
                    SyncSignal.WaitOne(options.PollIntervalMs);
                    SyncNotifications(listener, allowList);
                }
                catch (Exception ex)
                {
                    WriteError(string.Format("[toast-listener] sync failed: {0}", ex.Message));
                }
            }
        }
        catch (Exception ex)
        {
            WriteError(string.Format("[toast-listener] fatal: {0}", ex));
            return 1;
        }
    }

    private static Options ParseOptions(string[] args)
    {
        var options = new Options();
        options.SourceAllowList = "Code,Cursor,Windsurf,Trae,Kiro,CodeBuddy,Antigravity,JetBrains,Zed,Codex,PowerShell";
        options.PollIntervalMs = DefaultPollIntervalMs;
        options.ExitAfterInit = false;

        for (var index = 0; index < args.Length; index += 1)
        {
            var current = args[index];

            if (string.Equals(current, "--source-allow-list", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
            {
                options.SourceAllowList = args[index + 1];
                index += 1;
                continue;
            }

            if (string.Equals(current, "--poll-interval-ms", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
            {
                int pollIntervalMs;
                if (int.TryParse(args[index + 1], out pollIntervalMs) && pollIntervalMs > 0)
                {
                    options.PollIntervalMs = pollIntervalMs;
                }

                index += 1;
                continue;
            }

            if (string.Equals(current, "--exit-after-init", StringComparison.OrdinalIgnoreCase))
            {
                options.ExitAfterInit = true;
            }
        }

        return options;
    }

    private static HashSet<string> BuildAllowList(string sourceAllowList)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var entry in sourceAllowList.Split(','))
        {
            var trimmed = entry.Trim();

            if (!string.IsNullOrWhiteSpace(trimmed))
            {
                result.Add(trimmed);
            }
        }

        return result;
    }

    private static object AwaitWinRtOperation(object operation, Type operationInterfaceType)
    {
        var resultType = operationInterfaceType.GenericTypeArguments[0];
        var taskMethod = AsTaskMethod.MakeGenericMethod(resultType);
        var task = taskMethod.Invoke(null, new[] { operation });
        var getAwaiterMethod = task.GetType().GetMethod("GetAwaiter", BindingFlags.Public | BindingFlags.Instance);
        var awaiter = getAwaiterMethod.Invoke(task, null);
        var getResultMethod = awaiter.GetType().GetMethod("GetResult", BindingFlags.Public | BindingFlags.Instance);
        return getResultMethod.Invoke(awaiter, null);
    }

    private static IEnumerable GetNotifications(object listener)
    {
        var getNotificationsMethod = ListenerType.GetMethod("GetNotificationsAsync", BindingFlags.Public | BindingFlags.Instance);
        var toastKind = Enum.Parse(NotificationKindsType, "Toast");
        var operation = getNotificationsMethod.Invoke(listener, new[] { toastKind });
        var result = AwaitWinRtOperation(operation, getNotificationsMethod.ReturnType);
        return (IEnumerable)result;
    }

    private static int InitializeBaseline(object listener)
    {
        var currentIds = GetNotifications(listener)
            .Cast<object>()
            .Select(GetNotificationId)
            .ToList();

        SeenNotificationIds.Clear();

        foreach (var notificationId in currentIds)
        {
            SeenNotificationIds.Add(notificationId);
        }

        return currentIds.Count;
    }

    private static bool TrySubscribeNotificationChanged(object listener)
    {
        if (!HasPackageIdentity())
        {
            WriteError("[toast-listener] foreground event unavailable without package identity; using poll fallback");
            return false;
        }

        try
        {
            var addMethod = ListenerType.GetMethod("add_NotificationChanged", BindingFlags.Public | BindingFlags.Instance);
            if (addMethod == null)
            {
                return false;
            }

            var handlerMethod = typeof(Program).GetMethod(
                "OnNotificationChanged",
                BindingFlags.NonPublic | BindingFlags.Static
            );

            if (handlerMethod == null)
            {
                return false;
            }

            var handlerType = addMethod.GetParameters()[0].ParameterType;
            var handler = Delegate.CreateDelegate(handlerType, handlerMethod);
            addMethod.Invoke(listener, new object[] { handler });
            return true;
        }
        catch (Exception ex)
        {
            var details = ex.InnerException != null
                ? string.Format("{0} | inner={1}", ex.Message, ex.InnerException)
                : ex.ToString();
            WriteError(string.Format("[toast-listener] failed to subscribe foreground event: {0}", details));
            return false;
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetCurrentPackageFullName(ref int packageFullNameLength, StringBuilder packageFullName);

    private static bool HasPackageIdentity()
    {
        var length = 0;
        var result = GetCurrentPackageFullName(ref length, null);

        if (result == APPMODEL_ERROR_NO_PACKAGE)
        {
            return false;
        }

        return result == 0 || result == 122;
    }

    private static void OnNotificationChanged(object sender, object args)
    {
        try
        {
            var changeKind = GetStringProperty(args, "ChangeKind");
            var notificationId = GetUIntProperty(args, "UserNotificationId");
            WriteError(
                string.Format(
                    "[toast-listener] event: change={0}; id={1}",
                    string.IsNullOrWhiteSpace(changeKind) ? "unknown" : changeKind,
                    notificationId
                )
            );
        }
        catch
        {
        }

        SyncSignal.Set();
    }

    private static void SyncNotifications(object listener, HashSet<string> allowList)
    {
        var currentNotifications = GetNotifications(listener).Cast<object>().ToList();
        var currentIds = new HashSet<uint>();

        foreach (var notification in currentNotifications)
        {
            var notificationId = GetNotificationId(notification);
            currentIds.Add(notificationId);

            if (SeenNotificationIds.Contains(notificationId))
            {
                continue;
            }

            var payload = ConvertToPayload(notification, allowList);

            if (payload == null)
            {
                continue;
            }

            Console.WriteLine(payload.ToJson());
        }

        SeenNotificationIds.Clear();

        foreach (var notificationId in currentIds)
        {
            SeenNotificationIds.Add(notificationId);
        }
    }

    private static uint GetNotificationId(object userNotification)
    {
        var idValue = userNotification.GetType().GetProperty("Id", BindingFlags.Public | BindingFlags.Instance).GetValue(userNotification, null);
        return Convert.ToUInt32(idValue);
    }

    private static NotificationPayload ConvertToPayload(object userNotification, HashSet<string> allowList)
    {
        var notification = GetPropertyValue(userNotification, "Notification");
        var rawLines = GetTextLines(notification);
        var appInfo = GetPropertyValue(userNotification, "AppInfo");
        var displayName = GetNestedStringProperty(appInfo, "DisplayInfo", "DisplayName");
        var appUserModelId = GetStringProperty(appInfo, "AppUserModelId");
        var sourceApp = NormalizeSourceName(displayName, appUserModelId, rawLines);

        if (string.IsNullOrWhiteSpace(sourceApp) || !allowList.Contains(sourceApp))
        {
            return null;
        }

        var title = rawLines.Count >= 1 ? rawLines[0] : string.Empty;
        var body = rawLines.Count >= 2 ? string.Join(" / ", rawLines.Skip(1)) : string.Empty;
        var creationTimeValue = GetPropertyValue(userNotification, "CreationTime");
        var timestamp = creationTimeValue != null ? creationTimeValue.ToString() : DateTimeOffset.Now.ToString("o");

        return new NotificationPayload
        {
            SourceApp = sourceApp,
            Title = title,
            Body = body,
            Timestamp = timestamp,
            RawLines = rawLines,
            Category = "general",
            WorkspaceName = null,
            MatchReason = "user-notification-listener",
            SystemNotificationId = GetNotificationId(userNotification),
            AppUserModelId = appUserModelId,
            AppDisplayName = displayName
        };
    }

    private static List<string> GetTextLines(object notification)
    {
        var result = new List<string>();

        if (notification == null)
        {
            return result;
        }

        try
        {
            var visual = GetPropertyValue(notification, "Visual");

            if (visual == null)
            {
                return result;
            }

            var getBindingMethod = visual.GetType().GetMethod("GetBinding", new[] { typeof(string) });
            var binding = getBindingMethod.Invoke(visual, new object[] { "ToastGeneric" });

            if (binding == null)
            {
                return result;
            }

            var textElements = (IEnumerable)binding.GetType().GetMethod("GetTextElements", BindingFlags.Public | BindingFlags.Instance)
                .Invoke(binding, null);

            foreach (var element in textElements)
            {
                var text = GetStringProperty(element, "Text");

                if (!string.IsNullOrWhiteSpace(text))
                {
                    result.Add(text.Trim());
                }
            }
        }
        catch
        {
        }

        return result;
    }

    private static string NormalizeSourceName(string displayName, string appUserModelId, IEnumerable<string> rawLines)
    {
        foreach (var candidate in new[] { displayName, appUserModelId })
        {
            var normalized = NormalizeSourceCandidate(candidate);
            if (!string.IsNullOrWhiteSpace(normalized))
            {
                return normalized;
            }
        }

        foreach (var candidate in rawLines.Where(line => !string.IsNullOrWhiteSpace(line)))
        {
            var normalized = NormalizeSourceCandidate(candidate);
            if (!string.IsNullOrWhiteSpace(normalized))
            {
                return normalized;
            }
        }

        return null;
    }

    private static string NormalizeSourceCandidate(string candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return null;
        }

        var lower = candidate.Trim().ToLowerInvariant();
        var compact = lower.Replace(" ", string.Empty)
            .Replace(".", string.Empty)
            .Replace("_", string.Empty)
            .Replace("-", string.Empty);

        if (lower.Contains("cursor") || lower.Contains("anysphere.cursor"))
        {
            return "Cursor";
        }

        if (lower.Contains("windsurf"))
        {
            return "Windsurf";
        }

        if (compact.Contains("trae"))
        {
            return "Trae";
        }

        if (compact.Contains("kiro"))
        {
            return "Kiro";
        }

        if (compact.Contains("codebuddy"))
        {
            return "CodeBuddy";
        }

        if (compact.Contains("antigravity"))
        {
            return "Antigravity";
        }

        if (MatchesJetBrains(compact))
        {
            return "JetBrains";
        }

        if (MatchesZed(lower, compact))
        {
            return "Zed";
        }

        if (lower.Contains("codex") || lower.Contains("openai.codex"))
        {
            return "Codex";
        }

        if (lower.Contains("powershell") || lower.Contains("pwsh") || lower.Contains("powershell.exe"))
        {
            return "PowerShell";
        }

        if (lower.Contains("visual studio code") || lower.Contains("microsoft.visualstudiocode") || compact == "code" || compact == "vscode" || compact == "vscodeinsiders" || compact == "codeinsiders")
        {
            return "Code";
        }

        return null;
    }

    private static bool MatchesJetBrains(string compact)
    {
        return compact.Contains("jetbrains")
            || compact.Contains("junie")
            || compact.Contains("aiassistant")
            || compact.Contains("intellij")
            || compact.Contains("pycharm")
            || compact.Contains("webstorm")
            || compact.Contains("goland")
            || compact.Contains("clion")
            || compact.Contains("rider")
            || compact.Contains("androidstudio")
            || compact.Contains("phpstorm")
            || compact.Contains("rubymine")
            || compact.Contains("dataspell")
            || compact.Contains("fleet");
    }

    private static bool MatchesZed(string lower, string compact)
    {
        return compact == "zed"
            || compact.Contains("zededitor")
            || lower.Contains("dev.zed.zed")
            || lower.Contains("zed industries");
    }

    private static object GetPropertyValue(object instance, string propertyName)
    {
        if (instance == null)
        {
            return null;
        }

        var property = instance.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);

        if (property == null)
        {
            return null;
        }

        return property.GetValue(instance, null);
    }

    private static string GetStringProperty(object instance, string propertyName)
    {
        var value = GetPropertyValue(instance, propertyName);
        return value == null ? string.Empty : value.ToString();
    }

    private static uint GetUIntProperty(object instance, string propertyName)
    {
        var value = GetPropertyValue(instance, propertyName);
        if (value == null)
        {
            return 0;
        }

        try
        {
            return Convert.ToUInt32(value);
        }
        catch
        {
            return 0;
        }
    }

    private static string GetNestedStringProperty(object instance, string firstPropertyName, string secondPropertyName)
    {
        var nested = GetPropertyValue(instance, firstPropertyName);
        return GetStringProperty(nested, secondPropertyName);
    }

    private static void WriteError(string message)
    {
        Console.Error.WriteLine(message);
    }

    private sealed class Options
    {
        public string SourceAllowList { get; set; }

        public int PollIntervalMs { get; set; }

        public bool ExitAfterInit { get; set; }
    }

    private sealed class NotificationPayload
    {
        public string SourceApp { get; set; }

        public string Title { get; set; }

        public string Body { get; set; }

        public string Timestamp { get; set; }

        public List<string> RawLines { get; set; }

        public string Category { get; set; }

        public string WorkspaceName { get; set; }

        public string MatchReason { get; set; }

        public uint SystemNotificationId { get; set; }

        public string AppUserModelId { get; set; }

        public string AppDisplayName { get; set; }

        public string ToJson()
        {
            var builder = new StringBuilder();
            builder.Append('{');
            AppendProperty(builder, "sourceApp", SourceApp, true);
            AppendProperty(builder, "title", Title, false);
            AppendProperty(builder, "body", Body, false);
            AppendProperty(builder, "timestamp", Timestamp, false);
            AppendArrayProperty(builder, "rawLines", RawLines ?? new List<string>(), false);
            AppendProperty(builder, "category", Category, false);
            AppendNullableProperty(builder, "workspaceName", WorkspaceName, false);
            AppendProperty(builder, "matchReason", MatchReason, false);
            AppendNumberProperty(builder, "systemNotificationId", SystemNotificationId, false);
            AppendProperty(builder, "appUserModelId", AppUserModelId, false);
            AppendProperty(builder, "appDisplayName", AppDisplayName, false);
            builder.Append('}');
            return builder.ToString();
        }

        private static void AppendProperty(StringBuilder builder, string name, string value, bool isFirst)
        {
            if (!isFirst)
            {
                builder.Append(',');
            }

            builder.Append('"').Append(Escape(name)).Append("\":");
            builder.Append('"').Append(Escape(value ?? string.Empty)).Append('"');
        }

        private static void AppendNullableProperty(StringBuilder builder, string name, string value, bool isFirst)
        {
            if (!isFirst)
            {
                builder.Append(',');
            }

            builder.Append('"').Append(Escape(name)).Append("\":");

            if (value == null)
            {
                builder.Append("null");
                return;
            }

            builder.Append('"').Append(Escape(value)).Append('"');
        }

        private static void AppendNumberProperty(StringBuilder builder, string name, uint value, bool isFirst)
        {
            if (!isFirst)
            {
                builder.Append(',');
            }

            builder.Append('"').Append(Escape(name)).Append("\":").Append(value);
        }

        private static void AppendArrayProperty(StringBuilder builder, string name, IList<string> values, bool isFirst)
        {
            if (!isFirst)
            {
                builder.Append(',');
            }

            builder.Append('"').Append(Escape(name)).Append("\":[");

            for (var index = 0; index < values.Count; index += 1)
            {
                if (index > 0)
                {
                    builder.Append(',');
                }

                builder.Append('"').Append(Escape(values[index] ?? string.Empty)).Append('"');
            }

            builder.Append(']');
        }

        private static string Escape(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            var builder = new StringBuilder(value.Length + 8);

            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '"':
                        builder.Append("\\\"");
                        break;
                    case '\b':
                        builder.Append("\\b");
                        break;
                    case '\f':
                        builder.Append("\\f");
                        break;
                    case '\n':
                        builder.Append("\\n");
                        break;
                    case '\r':
                        builder.Append("\\r");
                        break;
                    case '\t':
                        builder.Append("\\t");
                        break;
                    default:
                        if (char.IsControl(ch))
                        {
                            builder.Append("\\u").Append(((int)ch).ToString("x4"));
                        }
                        else
                        {
                            builder.Append(ch);
                        }

                        break;
                }
            }

            return builder.ToString();
        }
    }
}

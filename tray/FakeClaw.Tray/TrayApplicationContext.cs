using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace FakeClaw.Tray
{
    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly Icon _appIcon;
        private readonly NotifyIcon _notifyIcon;
        private readonly ToolStripMenuItem _statusItem;
        private readonly ToolStripMenuItem _pauseItem;
        private readonly ToolStripMenuItem _resumeItem;
        private readonly ToolStripMenuItem _restartItem;
        private readonly ToolStripMenuItem _configItem;
        private readonly ToolStripMenuItem _exitItem;
        private readonly Timer _statusTimer;
        private readonly HttpClient _httpClient;
        private readonly JavaScriptSerializer _serializer;
        private readonly string _repoRoot;
        private readonly string _envPath;
        private string _serviceUrlBase;

        private Process _serviceProcess;
        private bool _exitRequested;
        private bool _napcatLaunchAttempted;
        private string _lastServiceError;
        private string _currentPlatform;

        public TrayApplicationContext()
        {
            _appIcon = TrayIconFactory.CreateTrayIcon();
            _repoRoot = ResolveRepoRoot();
            _envPath = Path.Combine(_repoRoot, ".env");
            _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            _serializer = new JavaScriptSerializer();
            _serviceUrlBase = BuildServiceUrlBase();

            _statusItem = new ToolStripMenuItem(BuildStatusText("启动中", _currentPlatform)) { Enabled = false };
            _pauseItem = new ToolStripMenuItem("暂停通知");
            _resumeItem = new ToolStripMenuItem("恢复通知");
            _restartItem = new ToolStripMenuItem("重启服务");
            _configItem = new ToolStripMenuItem("配置");
            _exitItem = new ToolStripMenuItem("退出");

            _pauseItem.Click += async (sender, args) => await PauseNotificationsAsync();
            _resumeItem.Click += async (sender, args) => await ResumeNotificationsAsync();
            _restartItem.Click += async (sender, args) => await RestartServiceAsync(false);
            _configItem.Click += async (sender, args) => await OpenConfigAsync();
            _exitItem.Click += async (sender, args) => await ExitApplicationAsync();

            var menu = new ContextMenuStrip();
            menu.Items.AddRange(new ToolStripItem[]
            {
                _statusItem,
                new ToolStripSeparator(),
                _pauseItem,
                _resumeItem,
                _restartItem,
                _configItem,
                new ToolStripSeparator(),
                _exitItem
            });

            _notifyIcon = new NotifyIcon
            {
                Text = "FakeClaw",
                Icon = _appIcon,
                Visible = true,
                ContextMenuStrip = menu
            };
            _notifyIcon.DoubleClick += async (sender, args) => await OpenConfigAsync();

            _statusTimer = new Timer { Interval = 2500 };
            _statusTimer.Tick += async (sender, args) => await RefreshStatusAsync();
            _statusTimer.Start();

            UpdateMenuState(BuildStatusText("启动中", _currentPlatform), false, false);
            var ignored = StartServiceAsync(true);
        }

        private async Task StartServiceAsync(bool allowNapCatLaunch)
        {
            if (_serviceProcess != null && !_serviceProcess.HasExited)
            {
                await RefreshStatusAsync();
                return;
            }

            if (!Directory.Exists(_repoRoot))
            {
                Fail("项目目录不存在，无法启动 FakeClaw。");
                return;
            }

            var env = EnvFile.Load(_envPath);
            _currentPlatform = NormalizePlatform(env.Get("BOT_PLATFORM", "napcat"));

            if (allowNapCatLaunch && _currentPlatform == "napcat" && !_napcatLaunchAttempted)
            {
                TryLaunchNapCat(env);
            }

            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "src/index.js",
                    WorkingDirectory = _repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };

                _serviceProcess = new Process
                {
                    StartInfo = startInfo,
                    EnableRaisingEvents = true
                };
                _serviceProcess.OutputDataReceived += HandleServiceOutput;
                _serviceProcess.ErrorDataReceived += HandleServiceError;
                _serviceProcess.Exited += HandleServiceExited;

                if (!_serviceProcess.Start())
                {
                    Fail("Node 服务启动失败。");
                    return;
                }

                _serviceProcess.BeginOutputReadLine();
                _serviceProcess.BeginErrorReadLine();

                UpdateMenuState(BuildStatusText("服务启动中", _currentPlatform), false, true);
                await WaitForServiceReadyAsync();
                await RefreshStatusAsync();
            }
            catch (Exception error)
            {
                Fail(string.Format("无法启动 Node 服务：{0}", error.Message));
            }
        }

        private async Task WaitForServiceReadyAsync()
        {
            for (var attempt = 0; attempt < 16; attempt += 1)
            {
                if (_serviceProcess == null || _serviceProcess.HasExited)
                {
                    break;
                }

                var status = await TryGetStatusAsync();
                if (status != null)
                {
                    return;
                }

                await Task.Delay(500);
            }
        }

        private void HandleServiceOutput(object sender, DataReceivedEventArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.Data))
            {
                return;
            }

            if (args.Data.IndexOf("[admin] error", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                _lastServiceError = args.Data.Trim();
            }
        }

        private void HandleServiceError(object sender, DataReceivedEventArgs args)
        {
            if (string.IsNullOrWhiteSpace(args.Data))
            {
                return;
            }

            _lastServiceError = args.Data.Trim();
        }

        private void HandleServiceExited(object sender, EventArgs args)
        {
            if (_exitRequested)
            {
                return;
            }

            UpdateMenuState(BuildStatusText("服务已停止", _currentPlatform), false, false);
            if (!string.IsNullOrWhiteSpace(_lastServiceError))
            {
                _notifyIcon.ShowBalloonTip(4000, "FakeClaw 服务已退出", _lastServiceError, ToolTipIcon.Warning);
            }
        }

        private async Task RefreshStatusAsync()
        {
            var status = await TryGetStatusAsync();
            if (status != null)
            {
                _currentPlatform = NormalizePlatform(status.botPlatform ?? _currentPlatform);

                var statusText = status.notificationsPaused
                    ? BuildStatusText("通知已暂停", _currentPlatform)
                    : BuildStatusText(string.Format("运行中 ({0})", status.status ?? "idle"), _currentPlatform);

                UpdateMenuState(statusText, status.notificationsPaused, true);
                _notifyIcon.Text = TrimNotifyText(
                    string.Format(
                        "FakeClaw [{0}] {1}",
                        GetPlatformDisplayName(_currentPlatform),
                        status.notificationsPaused ? "通知已暂停" : "运行中"
                    )
                );

                if (!string.IsNullOrWhiteSpace(status.lastError))
                {
                    _lastServiceError = status.lastError;
                }

                return;
            }

            var running = _serviceProcess != null && !_serviceProcess.HasExited;
            UpdateMenuState(BuildStatusText(running ? "服务未就绪" : "服务已停止", _currentPlatform), false, running);
            _notifyIcon.Text = TrimNotifyText(running ? "FakeClaw 服务未就绪" : "FakeClaw 服务已停止");
        }

        private async Task<AdminStatusResponse> TryGetStatusAsync()
        {
            try
            {
                var response = await _httpClient.GetAsync(_serviceUrlBase + "/admin/status");
                if (!response.IsSuccessStatusCode)
                {
                    return null;
                }

                var payload = await response.Content.ReadAsStringAsync();
                var status = _serializer.Deserialize<AdminStatusResponse>(payload);
                return status != null && status.ok ? status : null;
            }
            catch
            {
                return null;
            }
        }

        private async Task PauseNotificationsAsync()
        {
            await PostAsync("/admin/notifications/pause");
            await RefreshStatusAsync();
        }

        private async Task ResumeNotificationsAsync()
        {
            await PostAsync("/admin/notifications/resume");
            await RefreshStatusAsync();
        }

        private async Task OpenConfigAsync()
        {
            var previousPlatform = NormalizePlatform(EnvFile.Load(_envPath).Get("BOT_PLATFORM", "napcat"));

            using (var form = new ConfigForm(_envPath))
            {
                if (form.ShowDialog() != DialogResult.OK)
                {
                    return;
                }

                var nextPlatform = NormalizePlatform(form.SelectedPlatform);
                if (nextPlatform == "napcat" && previousPlatform != "napcat")
                {
                    _napcatLaunchAttempted = false;
                }

                if (form.ApplyToRunningService)
                {
                    await RestartServiceAsync(
                        nextPlatform == "napcat" && previousPlatform != "napcat",
                        BuildServiceUrlBase()
                    );
                }
                else
                {
                    _serviceUrlBase = BuildServiceUrlBase();
                    await RefreshStatusAsync();
                }
            }
        }

        private async Task RestartServiceAsync(bool forceNapCatLaunch, string nextServiceUrlBase = null)
        {
            UpdateMenuState(BuildStatusText("服务重启中", _currentPlatform), false, true);
            var currentServiceUrlBase = _serviceUrlBase;
            await StopServiceAsync(currentServiceUrlBase);
            if (!string.IsNullOrWhiteSpace(nextServiceUrlBase))
            {
                _serviceUrlBase = nextServiceUrlBase;
            }

            await StartServiceAsync(forceNapCatLaunch);
        }

        private async Task StopServiceAsync(string serviceUrlBase = null)
        {
            if (_serviceProcess == null)
            {
                return;
            }

            if (_serviceProcess.HasExited)
            {
                _serviceProcess.Dispose();
                _serviceProcess = null;
                return;
            }

            try
            {
                await PostAsync("/admin/shutdown", serviceUrlBase);
            }
            catch
            {
            }

            for (var attempt = 0; attempt < 12; attempt += 1)
            {
                if (_serviceProcess.HasExited)
                {
                    break;
                }

                await Task.Delay(250);
            }

            if (!_serviceProcess.HasExited)
            {
                KillProcessTree(_serviceProcess.Id);
            }

            _serviceProcess.Dispose();
            _serviceProcess = null;
        }

        private async Task ExitApplicationAsync()
        {
            _exitRequested = true;
            _statusTimer.Stop();
            await StopServiceAsync(_serviceUrlBase);
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _appIcon.Dispose();
            _httpClient.Dispose();
            ExitThread();
        }

        private async Task<string> PostAsync(string path, string serviceUrlBase = null)
        {
            var baseUrl = string.IsNullOrWhiteSpace(serviceUrlBase) ? _serviceUrlBase : serviceUrlBase;
            var response = await _httpClient.PostAsync(baseUrl + path, new StringContent(string.Empty));
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync();
        }

        private void TryLaunchNapCat(EnvFile env)
        {
            var scriptPath = env.Get("NAPCAT_START_SCRIPT", string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(scriptPath))
            {
                _notifyIcon.ShowBalloonTip(4000, "NapCat 未启动", "当前是 napcat 模式，但 NAPCAT_START_SCRIPT 未配置。", ToolTipIcon.Warning);
                return;
            }

            if (!File.Exists(scriptPath))
            {
                _notifyIcon.ShowBalloonTip(4000, "NapCat 未启动", "NAPCAT_START_SCRIPT 指向的文件不存在。", ToolTipIcon.Warning);
                return;
            }

            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = string.Format("/c \"\"{0}\"\"", scriptPath),
                    WorkingDirectory = Path.GetDirectoryName(scriptPath) ?? _repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                Process.Start(startInfo);
                _napcatLaunchAttempted = true;
            }
            catch (Exception error)
            {
                _notifyIcon.ShowBalloonTip(4000, "NapCat 启动失败", error.Message, ToolTipIcon.Warning);
            }
        }

        private void UpdateMenuState(string statusText, bool notificationsPaused, bool running)
        {
            _statusItem.Text = statusText;
            _pauseItem.Enabled = running && !notificationsPaused;
            _resumeItem.Enabled = running && notificationsPaused;
            _restartItem.Enabled = true;
            _configItem.Enabled = true;
        }

        private void Fail(string message)
        {
            _lastServiceError = message;
            UpdateMenuState(BuildStatusText("启动失败", _currentPlatform), false, false);
            _notifyIcon.Text = TrimNotifyText("FakeClaw 启动失败");
            _notifyIcon.ShowBalloonTip(4000, "FakeClaw 启动失败", message, ToolTipIcon.Error);
        }

        private string BuildServiceUrlBase()
        {
            var env = EnvFile.Load(_envPath);
            var host = env.Get("ADMIN_CONTROL_HOST", "127.0.0.1").Trim();
            var port = env.Get("ADMIN_CONTROL_PORT", "3213").Trim();

            if (string.IsNullOrWhiteSpace(host))
            {
                host = "127.0.0.1";
            }

            if (string.IsNullOrWhiteSpace(port))
            {
                port = "3213";
            }

            return string.Format("http://{0}:{1}", host, port);
        }

        private string ResolveRepoRoot()
        {
            var candidates = new[]
            {
                AppDomain.CurrentDomain.BaseDirectory,
                Environment.CurrentDirectory
            };

            foreach (var candidate in candidates)
            {
                var current = Path.GetFullPath(candidate);
                for (var depth = 0; depth < 6 && !string.IsNullOrEmpty(current); depth += 1)
                {
                    if (File.Exists(Path.Combine(current, "package.json")) &&
                        File.Exists(Path.Combine(current, "src", "index.js")))
                    {
                        return current;
                    }

                    var parent = Directory.GetParent(current);
                    if (parent == null)
                    {
                        break;
                    }

                    current = parent.FullName;
                }
            }

            return Environment.CurrentDirectory;
        }

        private static string NormalizePlatform(string platform)
        {
            var normalized = (platform ?? "napcat").Trim().ToLowerInvariant();
            return normalized == "telegram" || normalized == "feishu" || normalized == "wecom"
                ? normalized
                : "napcat";
        }

        private static string BuildStatusText(string statusLabel, string platform)
        {
            return string.Format("状态：{0} | 平台：{1}", statusLabel, GetPlatformDisplayName(platform));
        }

        private static string GetPlatformDisplayName(string platform)
        {
            switch (NormalizePlatform(platform))
            {
                case "telegram":
                    return "Telegram";
                case "feishu":
                    return "飞书";
                case "wecom":
                    return "企业微信";
                default:
                    return "QQ / NapCat";
            }
        }

        private static string TrimNotifyText(string text)
        {
            var value = text ?? "FakeClaw";
            return value.Length <= 63 ? value : value.Substring(0, 63);
        }

        private static void KillProcessTree(int processId)
        {
            try
            {
                var taskKill = new ProcessStartInfo
                {
                    FileName = "taskkill.exe",
                    Arguments = string.Format("/PID {0} /T /F", processId),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                using (var process = Process.Start(taskKill))
                {
                    if (process != null)
                    {
                        process.WaitForExit(5000);
                    }
                }
            }
            catch
            {
            }
        }

        private sealed class AdminStatusResponse
        {
            public bool ok { get; set; }

            public string status { get; set; }

            public string botPlatform { get; set; }

            public bool notificationsPaused { get; set; }

            public bool keepDisplayAwakeEnabled { get; set; }

            public bool keepDisplayAwakeRunning { get; set; }

            public string lastError { get; set; }
        }
    }
}

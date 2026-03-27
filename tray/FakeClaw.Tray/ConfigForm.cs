using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace FakeClaw.Tray
{
    internal sealed class ConfigForm : Form
    {
        private readonly string _envPath;
        private readonly EnvFile _envFile;
        private readonly Dictionary<string, TextBox> _textInputs;
        private readonly Dictionary<string, CheckBox> _checkInputs;
        private readonly ComboBox _platformComboBox;
        private readonly TabControl _platformTabs;

        public ConfigForm(string envPath)
        {
            _envPath = envPath;
            _envFile = EnvFile.Load(envPath);
            _textInputs = new Dictionary<string, TextBox>(StringComparer.OrdinalIgnoreCase);
            _checkInputs = new Dictionary<string, CheckBox>(StringComparer.OrdinalIgnoreCase);

            Text = "FakeClaw 配置";
            Icon = TrayIconFactory.CreateAppIcon();
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(720, 640);
            Size = new Size(720, 640);

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 2,
                Padding = new Padding(12)
            };
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(root);

            var scrollPanel = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                Padding = new Padding(0),
                Margin = new Padding(0)
            };
            root.Controls.Add(scrollPanel, 0, 0);

            var commonGroup = CreateGroup("常用配置");
            scrollPanel.Controls.Add(commonGroup);
            var commonBody = (FlowLayoutPanel)commonGroup.Controls[0];

            CreatePlatformHint(commonBody);
            CreateTextRow(commonBody, "应用显示名", "BOT_NAME", _envFile.Get("BOT_NAME", "FakeClaw"));
            CreateTextRow(
                commonBody,
                "通知来源白名单",
                "NOTIFY_SOURCE_ALLOWLIST",
                _envFile.Get("NOTIFY_SOURCE_ALLOWLIST", "Code,Cursor,Windsurf,Trae,Kiro,CodeBuddy,Antigravity,JetBrains,Zed,Codex,PowerShell")
            );
            CreateTextRow(commonBody, "通知轮询间隔(ms)", "NOTIFY_POLL_INTERVAL_MS", _envFile.Get("NOTIFY_POLL_INTERVAL_MS", "1500"));
            CreateTextRow(commonBody, "自动化超时(ms)", "AUTOMATION_TIMEOUT_MS", _envFile.Get("AUTOMATION_TIMEOUT_MS", "30000"));
            CreateCheckRow(commonBody, "防止自动黑屏", "KEEP_DISPLAY_AWAKE", _envFile.Get("KEEP_DISPLAY_AWAKE", "true"));
            CreateTextRow(commonBody, "保活心跳(秒)", "KEEP_DISPLAY_AWAKE_INTERVAL_SECONDS", _envFile.Get("KEEP_DISPLAY_AWAKE_INTERVAL_SECONDS", "30"));
            CreateTextRow(commonBody, "截图目录", "SCREENSHOT_DIR", _envFile.Get("SCREENSHOT_DIR", string.Empty), BrowseMode.Folder);
            CreateActionRow(commonBody, "校准网页", "打开校准网页", OpenCalibrationPage);

            var platformGroup = CreateGroup("可选接入平台");
            scrollPanel.Controls.Add(platformGroup);
            var platformBody = (FlowLayoutPanel)platformGroup.Controls[0];
            _platformComboBox = CreatePlatformSelector(platformBody);
            _platformTabs = CreatePlatformTabs(platformBody);

            var buttonPanel = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                AutoSize = true,
                Margin = new Padding(0, 12, 0, 0)
            };
            root.Controls.Add(buttonPanel, 0, 1);

            var cancelButton = new Button
            {
                Text = "取消",
                AutoSize = true
            };
            cancelButton.Click += (sender, args) => Close();
            buttonPanel.Controls.Add(cancelButton);

            var saveApplyButton = new Button
            {
                Text = "保存并应用",
                AutoSize = true
            };
            saveApplyButton.Click += (sender, args) => SaveAndClose(true);
            buttonPanel.Controls.Add(saveApplyButton);

            var saveButton = new Button
            {
                Text = "仅保存",
                AutoSize = true
            };
            saveButton.Click += (sender, args) => SaveAndClose(false);
            buttonPanel.Controls.Add(saveButton);

            SelectPlatform(NormalizePlatform(_envFile.Get("BOT_PLATFORM", "none")));
        }

        public bool ApplyToRunningService { get; private set; }

        public string SelectedPlatform
        {
            get
            {
                var selectedLabel = Convert.ToString(_platformComboBox.SelectedItem);
                if (!string.IsNullOrWhiteSpace(selectedLabel))
                {
                    return GetPlatformKeyByLabel(selectedLabel);
                }

                return NormalizePlatform(Convert.ToString(_platformTabs.SelectedTab != null ? _platformTabs.SelectedTab.Tag : "none"));
            }
        }

        private GroupBox CreateGroup(string title)
        {
            var group = new GroupBox
            {
                Text = title,
                Width = 660,
                AutoSize = true,
                Padding = new Padding(12),
                Margin = new Padding(0, 0, 0, 12)
            };

            var body = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoSize = true
            };

            group.Controls.Add(body);
            return group;
        }

        private void CreatePlatformHint(Control parent)
        {
            var row = CreateRowPanel();
            parent.Controls.Add(row);

            row.Controls.Add(CreateLabel("当前平台"));

            var hint = new Label
            {
                Width = 420,
                Height = 26,
                Text = "默认可保持“未配置 / 无机器人”。若需要消息平台，再切换到对应标签页填写配置；NapCat 需自行安装。",
                TextAlign = ContentAlignment.MiddleLeft
            };
            row.Controls.Add(hint);
        }

        private ComboBox CreatePlatformSelector(Control parent)
        {
            var row = CreateRowPanel();
            parent.Controls.Add(row);

            row.Controls.Add(CreateLabel("启动平台"));

            var comboBox = new ComboBox
            {
                Width = 420,
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            comboBox.Items.AddRange(new object[]
            {
                "未配置 / 无机器人",
                "QQ / NapCat",
                "Telegram",
                "飞书",
                "企业微信"
            });
            comboBox.SelectedIndexChanged += (sender, args) =>
            {
                SelectPlatformTab(GetPlatformKeyByLabel(Convert.ToString(comboBox.SelectedItem)));
            };

            row.Controls.Add(comboBox);
            return comboBox;
        }

        private TabControl CreatePlatformTabs(Control parent)
        {
            var tabs = new TabControl
            {
                Width = 620,
                Height = 320,
                Margin = new Padding(0)
            };
            tabs.SelectedIndexChanged += (sender, args) => SyncPlatformSelectorWithTabs();

            tabs.TabPages.Add(CreatePlatformTab("QQ / NapCat", "napcat", new[]
            {
                FieldDefinition.Text("NAPCAT_WS_URL", "NapCat WS 地址"),
                FieldDefinition.Masked("NAPCAT_TOKEN", "NapCat Token（可留空自动获取）"),
                FieldDefinition.File("NAPCAT_START_SCRIPT", "NapCat 启动脚本"),
                FieldDefinition.Text("QQ_USER_ID", "QQ 用户 ID")
            }));

            tabs.TabPages.Add(CreatePlatformTab("Telegram", "telegram", new[]
            {
                FieldDefinition.Masked("TELEGRAM_BOT_TOKEN", "Telegram Bot Token"),
                FieldDefinition.Text("TELEGRAM_CHAT_ID", "Telegram Chat ID")
            }));

            tabs.TabPages.Add(CreatePlatformTab("飞书", "feishu", new[]
            {
                FieldDefinition.Text("FEISHU_APP_ID", "飞书 App ID"),
                FieldDefinition.Masked("FEISHU_APP_SECRET", "飞书 App Secret"),
                FieldDefinition.Text("FEISHU_OPEN_ID", "飞书 Open ID")
            }));

            tabs.TabPages.Add(CreatePlatformTab("企业微信", "wecom", new[]
            {
                FieldDefinition.Text("WECOM_CORP_ID", "企微 Corp ID"),
                FieldDefinition.Masked("WECOM_CORP_SECRET", "企微 Corp Secret"),
                FieldDefinition.Text("WECOM_AGENT_ID", "企微 Agent ID"),
                FieldDefinition.Text("WECOM_USER_ID", "企微 User ID"),
                FieldDefinition.Masked("WECOM_TOKEN", "企微 Token"),
                FieldDefinition.Masked("WECOM_ENCODING_AES_KEY", "企微 Encoding AES Key")
            }));

            parent.Controls.Add(tabs);
            return tabs;
        }

        private TabPage CreatePlatformTab(string title, string platform, IEnumerable<FieldDefinition> fields)
        {
            var tabPage = new TabPage
            {
                Text = title,
                Tag = platform
            };

            var body = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                Padding = new Padding(12)
            };

            tabPage.Controls.Add(body);

            foreach (var field in fields)
            {
                CreateTextRow(body, field.Label, field.Key, _envFile.Get(field.Key, string.Empty), field.Mode, field.IsSecret);
            }

            return tabPage;
        }

        private void CreateTextRow(Control parent, string labelText, string key, string value)
        {
            CreateTextRow(parent, labelText, key, value, BrowseMode.None, false);
        }

        private void CreateTextRow(Control parent, string labelText, string key, string value, BrowseMode browseMode)
        {
            CreateTextRow(parent, labelText, key, value, browseMode, false);
        }

        private void CreateTextRow(Control parent, string labelText, string key, string value, BrowseMode browseMode, bool isSecret)
        {
            var row = CreateRowPanel();
            parent.Controls.Add(row);

            row.Controls.Add(CreateLabel(labelText));

            var textBox = new TextBox
            {
                Width = browseMode == BrowseMode.None ? 420 : 330,
                Text = value ?? string.Empty,
                UseSystemPasswordChar = isSecret
            };
            row.Controls.Add(textBox);
            _textInputs[key] = textBox;

            if (browseMode == BrowseMode.None)
            {
                return;
            }

            var browseButton = new Button
            {
                Text = "浏览",
                Width = 70
            };
            browseButton.Click += (sender, args) => BrowseIntoTextBox(textBox, browseMode);
            row.Controls.Add(browseButton);
        }

        private void CreateCheckRow(Control parent, string labelText, string key, string value)
        {
            var row = CreateRowPanel();
            parent.Controls.Add(row);

            row.Controls.Add(CreateLabel(labelText));

            var checkBox = new CheckBox
            {
                Width = 420,
                Checked = string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)
            };
            row.Controls.Add(checkBox);
            _checkInputs[key] = checkBox;
        }

        private void CreateActionRow(Control parent, string labelText, string buttonText, Action action)
        {
            var row = CreateRowPanel();
            parent.Controls.Add(row);

            row.Controls.Add(CreateLabel(labelText));

            var button = new Button
            {
                Text = buttonText,
                Width = 140
            };
            button.Click += (sender, args) => action();
            row.Controls.Add(button);
        }

        private static FlowLayoutPanel CreateRowPanel()
        {
            return new FlowLayoutPanel
            {
                Width = 620,
                Height = 34,
                Margin = new Padding(0, 0, 0, 8),
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false
            };
        }

        private static Label CreateLabel(string text)
        {
            return new Label
            {
                Text = text,
                Width = 160,
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(0, 8, 0, 0)
            };
        }

        private void SelectPlatform(string platform)
        {
            SelectPlatformTab(platform);
            SelectPlatformCombo(platform);
        }

        private void SelectPlatformTab(string platform)
        {
            var normalized = NormalizePlatform(platform);
            if (normalized == "none")
            {
                return;
            }

            foreach (TabPage tabPage in _platformTabs.TabPages)
            {
                if (string.Equals(NormalizePlatform(Convert.ToString(tabPage.Tag)), normalized, StringComparison.OrdinalIgnoreCase))
                {
                    if (_platformTabs.SelectedTab != tabPage)
                    {
                        _platformTabs.SelectedTab = tabPage;
                    }

                    return;
                }
            }
        }

        private void SelectPlatformCombo(string platform)
        {
            var label = GetPlatformLabel(platform);
            if (!string.Equals(Convert.ToString(_platformComboBox.SelectedItem), label, StringComparison.Ordinal))
            {
                _platformComboBox.SelectedItem = label;
            }
        }

        private void SyncPlatformSelectorWithTabs()
        {
            if (_platformTabs.SelectedTab == null)
            {
                return;
            }

            SelectPlatformCombo(Convert.ToString(_platformTabs.SelectedTab.Tag));
        }

        private void BrowseIntoTextBox(TextBox textBox, BrowseMode browseMode)
        {
            if (browseMode == BrowseMode.File)
            {
                using (var dialog = new OpenFileDialog())
                {
                    dialog.CheckFileExists = true;
                    dialog.FileName = textBox.Text;
                    if (dialog.ShowDialog(this) == DialogResult.OK)
                    {
                        textBox.Text = dialog.FileName;
                    }
                }

                return;
            }

            using (var dialog = new FolderBrowserDialog())
            {
                dialog.SelectedPath = textBox.Text;
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    textBox.Text = dialog.SelectedPath;
                }
            }
        }

        private void OpenCalibrationPage()
        {
            var host = _envFile.Get("CALIBRATION_WEB_HOST", "127.0.0.1").Trim();
            var port = _envFile.Get("CALIBRATION_WEB_PORT", "3210").Trim();

            if (string.IsNullOrWhiteSpace(host))
            {
                host = "127.0.0.1";
            }

            if (string.IsNullOrWhiteSpace(port))
            {
                port = "3210";
            }

            var url = string.Format("http://{0}:{1}/calibration/", host, port);

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception error)
            {
                MessageBox.Show(this, string.Format("无法打开校准网页：{0}", error.Message), "打开失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void SaveAndClose(bool applyToRunningService)
        {
            var selectedPlatform = NormalizePlatform(SelectedPlatform);
            string validationError;
            if (!ValidateInputs(selectedPlatform, out validationError))
            {
                MessageBox.Show(this, validationError, "配置不完整", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _envFile.Set("BOT_PLATFORM", selectedPlatform);

            foreach (var entry in _textInputs)
            {
                _envFile.Set(entry.Key, entry.Value.Text.Trim());
            }

            foreach (var entry in _checkInputs)
            {
                _envFile.Set(entry.Key, entry.Value.Checked ? "true" : "false");
            }

            _envFile.Save(_envPath);
            ApplyToRunningService = applyToRunningService;
            DialogResult = DialogResult.OK;
            Close();
        }

        private bool ValidateInputs(string selectedPlatform, out string validationError)
        {
            validationError = string.Empty;

            foreach (var key in GetRequiredKeys(selectedPlatform))
            {
                TextBox textBox;
                if (_textInputs.TryGetValue(key, out textBox) && string.IsNullOrWhiteSpace(textBox.Text))
                {
                    validationError = string.Format("字段 {0} 不能为空。", key);
                    return false;
                }
            }

            int numericValue;
            if (!int.TryParse(GetText("NOTIFY_POLL_INTERVAL_MS"), out numericValue) || numericValue <= 0)
            {
                validationError = "通知轮询间隔必须是正整数。";
                return false;
            }

            if (!int.TryParse(GetText("AUTOMATION_TIMEOUT_MS"), out numericValue) || numericValue <= 0)
            {
                validationError = "自动化超时必须是正整数。";
                return false;
            }

            if (!int.TryParse(GetText("KEEP_DISPLAY_AWAKE_INTERVAL_SECONDS"), out numericValue) || numericValue <= 0)
            {
                validationError = "保活心跳必须是正整数秒。";
                return false;
            }

            var napcatScript = GetText("NAPCAT_START_SCRIPT");
            if (selectedPlatform == "napcat" && !string.IsNullOrWhiteSpace(napcatScript) && !File.Exists(napcatScript))
            {
                validationError = "NapCat 启动脚本路径不存在。";
                return false;
            }

            return true;
        }

        private string GetText(string key)
        {
            TextBox textBox;
            return _textInputs.TryGetValue(key, out textBox) ? textBox.Text.Trim() : string.Empty;
        }

        private static string NormalizePlatform(string platform)
        {
            var normalized = (platform ?? "none").Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return "none";
            }

            return normalized == "none" || normalized == "telegram" || normalized == "feishu" || normalized == "wecom"
                ? normalized
                : "napcat";
        }

        private static string GetPlatformLabel(string platform)
        {
            switch (NormalizePlatform(platform))
            {
                case "none":
                    return "未配置 / 无机器人";
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

        private static string GetPlatformKeyByLabel(string label)
        {
            switch ((label ?? string.Empty).Trim())
            {
                case "未配置 / 无机器人":
                    return "none";
                case "Telegram":
                    return "telegram";
                case "飞书":
                    return "feishu";
                case "企业微信":
                    return "wecom";
                default:
                    return "napcat";
            }
        }

        private static IEnumerable<string> GetRequiredKeys(string platform)
        {
            switch (NormalizePlatform(platform))
            {
                case "none":
                    return new string[0];
                case "telegram":
                    return new[] { "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID" };
                case "feishu":
                    return new[] { "FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_OPEN_ID" };
                case "wecom":
                    return new[] { "WECOM_CORP_ID", "WECOM_CORP_SECRET", "WECOM_AGENT_ID", "WECOM_USER_ID", "WECOM_TOKEN", "WECOM_ENCODING_AES_KEY" };
                default:
                    return new[] { "NAPCAT_WS_URL", "NAPCAT_START_SCRIPT", "QQ_USER_ID" };
            }
        }

        private sealed class FieldDefinition
        {
            public string Key { get; private set; }

            public string Label { get; private set; }

            public bool IsSecret { get; private set; }

            public BrowseMode Mode { get; private set; }

            public static FieldDefinition Text(string key, string label)
            {
                return new FieldDefinition { Key = key, Label = label, Mode = BrowseMode.None };
            }

            public static FieldDefinition Masked(string key, string label)
            {
                return new FieldDefinition { Key = key, Label = label, IsSecret = true, Mode = BrowseMode.None };
            }

            public static FieldDefinition File(string key, string label)
            {
                return new FieldDefinition { Key = key, Label = label, Mode = BrowseMode.File };
            }
        }

        private enum BrowseMode
        {
            None,
            File,
            Folder
        }
    }
}

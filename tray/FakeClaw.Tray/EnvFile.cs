using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace FakeClaw.Tray
{
    internal sealed class EnvFile
    {
        private static readonly Regex KeyValuePattern = new Regex(
            @"^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$",
            RegexOptions.Compiled
        );

        private readonly List<EnvLine> _lines;
        private readonly Dictionary<string, EnvLine> _lineByKey;

        private EnvFile(List<EnvLine> lines)
        {
            _lines = lines;
            _lineByKey = new Dictionary<string, EnvLine>(StringComparer.OrdinalIgnoreCase);

            foreach (var line in _lines)
            {
                if (line.IsKeyValue && !_lineByKey.ContainsKey(line.Key))
                {
                    _lineByKey[line.Key] = line;
                }
            }
        }

        public static EnvFile Load(string path)
        {
            var lines = new List<EnvLine>();

            if (File.Exists(path))
            {
                foreach (var rawLine in File.ReadAllLines(path))
                {
                    var match = KeyValuePattern.Match(rawLine);
                    if (!match.Success)
                    {
                        lines.Add(EnvLine.FromRaw(rawLine));
                        continue;
                    }

                    lines.Add(EnvLine.FromKeyValue(match.Groups[1].Value, match.Groups[2].Value));
                }
            }

            return new EnvFile(lines);
        }

        public string Get(string key, string fallback = "")
        {
            EnvLine line;
            if (_lineByKey.TryGetValue(key, out line))
            {
                return line.Value;
            }

            return fallback;
        }

        public void Set(string key, string value)
        {
            EnvLine line;
            if (_lineByKey.TryGetValue(key, out line))
            {
                line.Value = value ?? string.Empty;
                return;
            }

            line = EnvLine.FromKeyValue(key, value ?? string.Empty);
            _lines.Add(line);
            _lineByKey[key] = line;
        }

        public void Save(string path)
        {
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            using (var writer = new StreamWriter(path, false, new System.Text.UTF8Encoding(false)))
            {
                foreach (var line in _lines)
                {
                    writer.WriteLine(line.IsKeyValue ? string.Format("{0}={1}", line.Key, line.Value) : line.RawText);
                }
            }
        }

        private sealed class EnvLine
        {
            public bool IsKeyValue { get; private set; }

            public string Key { get; private set; }

            public string Value { get; set; }

            public string RawText { get; private set; }

            public static EnvLine FromRaw(string rawText)
            {
                return new EnvLine
                {
                    IsKeyValue = false,
                    RawText = rawText ?? string.Empty,
                    Key = string.Empty,
                    Value = string.Empty
                };
            }

            public static EnvLine FromKeyValue(string key, string value)
            {
                return new EnvLine
                {
                    IsKeyValue = true,
                    Key = key ?? string.Empty,
                    Value = value ?? string.Empty,
                    RawText = string.Empty
                };
            }
        }
    }
}

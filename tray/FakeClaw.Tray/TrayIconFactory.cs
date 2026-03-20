using System;
using System.Drawing;
using System.Windows.Forms;

namespace FakeClaw.Tray
{
    internal static class TrayIconFactory
    {
        public static Icon CreateAppIcon()
        {
            return LoadExecutableIcon(64);
        }

        public static Icon CreateTrayIcon()
        {
            return LoadExecutableIcon(32);
        }

        private static Icon LoadExecutableIcon(int size)
        {
            try
            {
                using (var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath))
                {
                    if (icon != null)
                    {
                        return new Icon(icon, new Size(size, size));
                    }
                }
            }
            catch (Exception)
            {
            }

            return (Icon)SystemIcons.Application.Clone();
        }
    }
}

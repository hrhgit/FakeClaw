using System;
using System.Threading;
using System.Windows.Forms;

namespace FakeClaw.Tray
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, @"Global\FakeClaw.Tray", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show("FakeClaw 托盘程序已经在运行。", "FakeClaw", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApplicationContext());
            }
        }
    }
}

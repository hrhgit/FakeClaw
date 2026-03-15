using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace FakeClaw.Tray
{
    internal static class TrayIconFactory
    {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        public static Icon CreateAppIcon()
        {
            return CreateIcon(64);
        }

        public static Icon CreateTrayIcon()
        {
            return CreateIcon(32);
        }

        private static Icon CreateIcon(int size)
        {
            using (var bitmap = new Bitmap(size, size))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.Clear(Color.Transparent);

                DrawBackground(graphics, size);
                DrawClaw(graphics, size);
                DrawStatusDot(graphics, size);

                var iconHandle = bitmap.GetHicon();

                try
                {
                    using (var icon = Icon.FromHandle(iconHandle))
                    {
                        return (Icon)icon.Clone();
                    }
                }
                finally
                {
                    DestroyIcon(iconHandle);
                }
            }
        }

        private static void DrawBackground(Graphics graphics, int size)
        {
            var bounds = new RectangleF(size * 0.08f, size * 0.08f, size * 0.84f, size * 0.84f);

            using (var brush = new LinearGradientBrush(
                new PointF(bounds.Left, bounds.Top),
                new PointF(bounds.Right, bounds.Bottom),
                Color.FromArgb(255, 17, 28, 44),
                Color.FromArgb(255, 10, 89, 98)))
            {
                var blend = new ColorBlend
                {
                    Colors = new[]
                    {
                        Color.FromArgb(255, 18, 31, 48),
                        Color.FromArgb(255, 18, 92, 103),
                        Color.FromArgb(255, 6, 133, 122)
                    },
                    Positions = new[] { 0f, 0.6f, 1f }
                };
                brush.InterpolationColors = blend;

                using (var path = CreateRoundedRect(bounds, size * 0.2f))
                {
                    graphics.FillPath(brush, path);
                }
            }

            using (var borderPen = new Pen(Color.FromArgb(140, 255, 255, 255), Math.Max(1f, size * 0.035f)))
            using (var path = CreateRoundedRect(bounds, size * 0.2f))
            {
                graphics.DrawPath(borderPen, path);
            }
        }

        private static void DrawClaw(Graphics graphics, int size)
        {
            var centerX = size * 0.44f;
            var topY = size * 0.2f;
            var strokeWidth = Math.Max(2f, size * 0.085f);

            using (var pen = new Pen(Color.FromArgb(255, 236, 255, 250), strokeWidth))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;

                for (var index = 0; index < 3; index += 1)
                {
                    var offsetX = (index - 1) * size * 0.15f;
                    var start = new PointF(centerX + offsetX, topY + index * size * 0.02f);
                    var control1 = new PointF(centerX + offsetX + size * 0.01f, topY + size * 0.18f);
                    var control2 = new PointF(centerX + offsetX - size * 0.04f, topY + size * 0.43f);
                    var end = new PointF(centerX + offsetX + size * 0.02f, topY + size * 0.62f);

                    using (var path = new GraphicsPath())
                    {
                        path.AddBezier(start, control1, control2, end);
                        graphics.DrawPath(pen, path);
                    }
                }
            }

            using (var glowBrush = new SolidBrush(Color.FromArgb(70, 110, 255, 245)))
            {
                graphics.FillEllipse(glowBrush, size * 0.18f, size * 0.5f, size * 0.38f, size * 0.2f);
            }
        }

        private static void DrawStatusDot(Graphics graphics, int size)
        {
            var dotSize = size * 0.22f;
            var x = size * 0.67f;
            var y = size * 0.64f;

            using (var shadow = new SolidBrush(Color.FromArgb(90, 0, 0, 0)))
            {
                graphics.FillEllipse(shadow, x + size * 0.02f, y + size * 0.02f, dotSize, dotSize);
            }

            using (var fill = new SolidBrush(Color.FromArgb(255, 255, 140, 64)))
            {
                graphics.FillEllipse(fill, x, y, dotSize, dotSize);
            }

            using (var inner = new SolidBrush(Color.FromArgb(220, 255, 218, 176)))
            {
                graphics.FillEllipse(inner, x + dotSize * 0.18f, y + dotSize * 0.18f, dotSize * 0.34f, dotSize * 0.34f);
            }
        }

        private static GraphicsPath CreateRoundedRect(RectangleF bounds, float radius)
        {
            var diameter = radius * 2f;
            var path = new GraphicsPath();

            path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();

            return path;
        }
    }
}

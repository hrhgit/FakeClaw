using System;
using System.IO;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 2 || string.IsNullOrWhiteSpace(args[0]) || string.IsNullOrWhiteSpace(args[1]))
        {
            Console.Error.WriteLine("Usage: generate-app-icon <input.png> <output.ico>");
            return 1;
        }

        WriteIcon(args[0], args[1]);
        Console.WriteLine("[ok] Wrote icon: " + args[1]);
        return 0;
    }

    private static void WriteIcon(string inputPath, string outputPath)
    {
        var pngBytes = File.ReadAllBytes(inputPath);

        using (var stream = File.Open(outputPath, FileMode.Create, FileAccess.Write))
        using (var writer = new BinaryWriter(stream))
        {
            writer.Write((ushort)0);
            writer.Write((ushort)1);
            writer.Write((ushort)1);

            writer.Write((byte)0);
            writer.Write((byte)0);
            writer.Write((byte)0);
            writer.Write((byte)0);
            writer.Write((ushort)1);
            writer.Write((ushort)32);
            writer.Write(pngBytes.Length);
            writer.Write(22);

            writer.Write(pngBytes);
        }
    }
}

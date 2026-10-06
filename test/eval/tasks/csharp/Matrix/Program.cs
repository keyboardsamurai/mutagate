using Matrix;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(services => CreateMatrix(services.GetRequiredService<IConfiguration>()));

var app = builder.Build();
app.MapGet("/", (MatrixService matrix) => Results.Content(MatrixPage.Render(matrix), "text/html"));
app.MapMatrixApi();
app.Run();

public partial class Program
{
    public static MatrixService CreateMatrix(IConfiguration config)
    {
        var size = config["Matrix:Size"] ?? "3x3";
        var fill = config.GetValue("Matrix:Fill", 0);
        var parts = size.Trim().ToLowerInvariant().Split('x');
        if (parts.Length != 2)
        {
            throw new ArgumentException($"Matrix:Size must look like <rows>x<cols>, got {size}");
        }
        var matrix = new MatrixService(int.Parse(parts[0].Trim()), int.Parse(parts[1].Trim()));
        for (int r = 0; r < matrix.Rows; r++)
        {
            for (int c = 0; c < matrix.Cols; c++)
            {
                matrix.Set(r, c, fill);
            }
        }
        return matrix;
    }
}

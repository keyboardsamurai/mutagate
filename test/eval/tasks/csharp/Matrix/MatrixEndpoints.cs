namespace Matrix;

public static class MatrixEndpoints
{
    public static RouteGroupBuilder MapMatrixApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/matrix");
        api.AddEndpointFilter(async (context, next) =>
        {
            try
            {
                return await next(context);
            }
            catch (Exception e) when (e is ArgumentException or IndexOutOfRangeException or OverflowException)
            {
                return BadRequest(e);
            }
        });
        api.MapGet("/", Describe);
        api.MapGet("/cells/{row:int}/{col:int}", Get);
        api.MapPut("/cells/{row:int}/{col:int}", Set);
        api.MapPost("/cells/{row:int}/{col:int}/add", Add);
        api.MapDelete("/", Clear);
        return api;
    }

    public static IResult Describe(MatrixService matrix) =>
        Results.Ok(new { rows = matrix.Rows, cols = matrix.Cols, cells = matrix.Snapshot() });

    public static int Get(MatrixService matrix, int row, int col) => matrix.Get(row, col);

    public static int Set(MatrixService matrix, int row, int col, int value)
    {
        matrix.Set(row, col, value);
        return value;
    }

    public static int Add(MatrixService matrix, int row, int col, int delta) => matrix.Add(row, col, delta);

    public static IResult Clear(MatrixService matrix)
    {
        matrix.Clear();
        return Results.NoContent();
    }

    public static IResult BadRequest(Exception e)
    {
        var message = string.IsNullOrEmpty(e.Message) ? e.GetType().Name : e.Message;
        return Results.BadRequest(new Dictionary<string, string> { ["error"] = message });
    }
}

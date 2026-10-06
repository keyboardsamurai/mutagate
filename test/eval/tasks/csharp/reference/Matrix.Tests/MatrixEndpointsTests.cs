using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Matrix.Tests;

public class MatrixEndpointsTests
{
    private static async Task<(WebApplication App, HttpClient Client)> Start()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddSingleton(new MatrixService(2, 2));
        var app = builder.Build();
        app.MapMatrixApi();
        await app.StartAsync();
        return (app, app.GetTestClient());
    }

    [Fact]
    public async Task ServesCells()
    {
        var (app, client) = await Start();
        await using var _ = app;
        Assert.Equal(7, await (await client.PutAsync("/api/matrix/cells/1/0?value=7", null)).Content.ReadFromJsonAsync<int>());
        Assert.Equal(7, await client.GetFromJsonAsync<int>("/api/matrix/cells/1/0"));
        Assert.Equal(10, await (await client.PostAsync("/api/matrix/cells/1/0/add?delta=3", null)).Content.ReadFromJsonAsync<int>());
        var body = await client.GetFromJsonAsync<Body>("/api/matrix");
        Assert.Equal(2, body!.Rows);
        Assert.Equal(2, body.Cols);
        Assert.Equal(new[] { new[] { 0, 0 }, new[] { 10, 0 } }, body.Cells);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/matrix")).StatusCode);
        Assert.Equal(0, app.Services.GetRequiredService<MatrixService>().Get(1, 0));
    }

    [Theory]
    [InlineData("/api/matrix/cells/5/0")]
    [InlineData("/api/matrix/cells/0/-1")]
    public async Task MapsBoundsErrorsToBadRequest(string url)
    {
        var (app, client) = await Start();
        await using var _ = app;
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("outside", (await response.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["error"]);
    }

    [Fact]
    public async Task MapsOverflowToBadRequest()
    {
        var (app, client) = await Start();
        await using var _ = app;
        await client.PutAsync($"/api/matrix/cells/0/0?value={int.MaxValue}", null);
        var response = await client.PostAsync("/api/matrix/cells/0/0/add?delta=1", null);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task LetsOtherErrorsThrough()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        var app = builder.Build();
        app.MapMatrixApi().MapGet("/boom", () => { throw new InvalidOperationException("boom"); });
        await app.StartAsync();
        await using var _ = app;
        await Assert.ThrowsAsync<InvalidOperationException>(() => app.GetTestClient().GetAsync("/api/matrix/boom"));
    }

    [Fact]
    public void BadRequestFallsBackToTheExceptionName()
    {
        Assert.Equal(new Dictionary<string, string> { ["error"] = "overflow" }, Value(MatrixEndpoints.BadRequest(new OverflowException("overflow"))));
        Assert.Equal(new Dictionary<string, string> { ["error"] = "ArgumentException" }, Value(MatrixEndpoints.BadRequest(new ArgumentException(""))));
    }

    private static object? Value(Microsoft.AspNetCore.Http.IResult result) =>
        ((Microsoft.AspNetCore.Http.HttpResults.BadRequest<Dictionary<string, string>>)result).Value;

    private record Body(int Rows, int Cols, int[][] Cells);
}

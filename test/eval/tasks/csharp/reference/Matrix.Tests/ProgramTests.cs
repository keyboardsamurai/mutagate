using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Matrix.Tests;

public class ProgramTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value))).Build();

    [Fact]
    public void BuildsFilledMatrixFromConfiguration()
    {
        var matrix = Program.CreateMatrix(Config(("Matrix:Size", " 2X3 "), ("Matrix:Fill", "7")));
        Assert.Equal(new[] { new[] { 7, 7, 7 }, new[] { 7, 7, 7 } }, matrix.Snapshot());
    }

    [Fact]
    public void DefaultsToAnEmptyThreeByThreeMatrix()
    {
        var matrix = Program.CreateMatrix(Config());
        Assert.Equal(3, matrix.Rows);
        Assert.Equal(3, matrix.Cols);
        Assert.All(matrix.Snapshot().SelectMany(row => row), value => Assert.Equal(0, value));
    }

    [Theory]
    [InlineData("3")]
    [InlineData("2x3x4")]
    public void RejectsMalformedSize(string size)
    {
        Assert.Throws<ArgumentException>(() => Program.CreateMatrix(Config(("Matrix:Size", size))));
    }

    [Fact]
    public async Task ServesPageAndApi()
    {
        var client = factory.CreateClient();
        var page = await client.GetAsync("/");
        Assert.Equal("text/html", page.Content.Headers.ContentType!.MediaType);
        Assert.Contains("<h1>Matrix 3x3</h1>", await page.Content.ReadAsStringAsync());
        Assert.Equal(0, await client.GetFromJsonAsync<int>("/api/matrix/cells/2/2"));
    }
}

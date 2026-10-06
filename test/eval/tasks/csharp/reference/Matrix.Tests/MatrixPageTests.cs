using Xunit;

namespace Matrix.Tests;

public class MatrixPageTests
{
    [Fact]
    public void RendersNumberedRowsWithSignClasses()
    {
        var matrix = new MatrixService(2, 2);
        matrix.Set(0, 0, -3);
        matrix.Set(1, 1, 4);
        Assert.Equal(
            "<!DOCTYPE html><html><head><title>Matrix</title></head><body><h1>Matrix 2x2</h1><table>"
            + "<tr><th>1</th><td class='negative'>-3</td><td class='zero'>0</td></tr>"
            + "<tr><th>2</th><td class='zero'>0</td><td class='positive'>4</td></tr>"
            + "</table></body></html>",
            MatrixPage.Render(matrix));
    }
}

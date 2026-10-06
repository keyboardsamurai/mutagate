using System.Text;

namespace Matrix;

public static class MatrixPage
{
    public static string Render(MatrixService matrix)
    {
        var grid = matrix.Snapshot();
        var html = new StringBuilder("<!DOCTYPE html><html><head><title>Matrix</title></head><body>");
        html.Append("<h1>Matrix ").Append(matrix.Rows).Append('x').Append(matrix.Cols).Append("</h1><table>");
        for (int r = 0; r < grid.Length; r++)
        {
            html.Append("<tr><th>").Append(r + 1).Append("</th>");
            foreach (var value in grid[r])
            {
                var kind = value < 0 ? "negative" : value == 0 ? "zero" : "positive";
                html.Append("<td class='").Append(kind).Append("'>").Append(value).Append("</td>");
            }
            html.Append("</tr>");
        }
        return html.Append("</table></body></html>").ToString();
    }
}

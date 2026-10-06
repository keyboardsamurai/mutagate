using Xunit;

namespace Matrix.Tests;

public class MatrixServiceTests
{
    [Fact]
    public void AcceptsDimensionsWithinLimits()
    {
        var small = new MatrixService(1, 1);
        Assert.Equal(1, small.Rows);
        Assert.Equal(1, small.Cols);
        var large = new MatrixService(MatrixService.MaxSize, 2);
        Assert.Equal(1000, large.Rows);
        Assert.Equal(2, large.Cols);
        Assert.Equal(1000, new MatrixService(2, 1000).Cols);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(1, 0)]
    [InlineData(-1, 3)]
    [InlineData(1001, 1)]
    [InlineData(1, 1001)]
    public void RejectsInvalidDimensions(int rows, int cols)
    {
        Assert.Throws<ArgumentException>(() => new MatrixService(rows, cols));
    }

    [Fact]
    public void ReadsWritesAndAddsCells()
    {
        var matrix = new MatrixService(2, 3);
        Assert.Equal(0, matrix.Get(1, 2));
        matrix.Set(1, 2, 5);
        matrix.Set(0, 1, -4);
        Assert.Equal(5, matrix.Get(1, 2));
        Assert.Equal(-4, matrix.Get(0, 1));
        Assert.Equal(0, matrix.Get(1, 1));
        Assert.Equal(8, matrix.Add(1, 2, 3));
        Assert.Equal(8, matrix.Get(1, 2));
        Assert.Equal(-4, matrix.Add(0, 1, 0));
    }

    [Theory]
    [InlineData(-1, 0)]
    [InlineData(2, 0)]
    [InlineData(0, -1)]
    [InlineData(0, 3)]
    public void RejectsCellsOutsideTheMatrix(int row, int col)
    {
        var matrix = new MatrixService(2, 3);
        Assert.Throws<IndexOutOfRangeException>(() => matrix.Get(row, col));
        Assert.Throws<IndexOutOfRangeException>(() => matrix.Set(row, col, 1));
        Assert.Throws<IndexOutOfRangeException>(() => matrix.Add(row, col, 1));
    }

    [Fact]
    public void DetectsOverflow()
    {
        var matrix = new MatrixService(1, 1);
        matrix.Set(0, 0, int.MaxValue);
        Assert.Throws<OverflowException>(() => matrix.Add(0, 0, 1));
        Assert.Equal(int.MaxValue, matrix.Get(0, 0));
        matrix.Set(0, 0, int.MinValue);
        Assert.Throws<OverflowException>(() => matrix.Add(0, 0, -1));
    }

    [Fact]
    public void ClearsAndSnapshots()
    {
        var matrix = new MatrixService(2, 2);
        matrix.Set(0, 1, 1);
        matrix.Set(1, 0, 2);
        var snapshot = matrix.Snapshot();
        Assert.Equal(new[] { new[] { 0, 1 }, new[] { 2, 0 } }, snapshot);
        snapshot[0][1] = 99;
        Assert.Equal(1, matrix.Get(0, 1));
        matrix.Clear();
        Assert.Equal(new[] { new[] { 0, 0 }, new[] { 0, 0 } }, matrix.Snapshot());
    }
}

namespace Matrix;

public class MatrixService
{
    public const int MaxSize = 1000;

    private readonly int[] cells;

    public MatrixService(int rows, int cols)
    {
        if (rows < 1 || cols < 1)
        {
            throw new ArgumentException($"matrix dimensions must be positive, got {rows}x{cols}");
        }
        if (rows > MaxSize || cols > MaxSize)
        {
            throw new ArgumentException($"matrix dimensions must not exceed {MaxSize}, got {rows}x{cols}");
        }
        Rows = rows;
        Cols = cols;
        cells = new int[rows * cols];
    }

    public int Rows { get; }

    public int Cols { get; }

    public int Get(int row, int col) => Volatile.Read(ref cells[Index(row, col)]);

    public void Set(int row, int col, int value) => Interlocked.Exchange(ref cells[Index(row, col)], value);

    public int Add(int row, int col, int delta)
    {
        ref int cell = ref cells[Index(row, col)];
        while (true)
        {
            int current = Volatile.Read(ref cell);
            int next = checked(current + delta);
            if (Interlocked.CompareExchange(ref cell, next, current) == current)
            {
                return next;
            }
        }
    }

    public void Clear()
    {
        for (int i = 0; i < cells.Length; i++)
        {
            Interlocked.Exchange(ref cells[i], 0);
        }
    }

    public int[][] Snapshot()
    {
        var grid = new int[Rows][];
        for (int r = 0; r < Rows; r++)
        {
            grid[r] = new int[Cols];
            for (int c = 0; c < Cols; c++)
            {
                grid[r][c] = Get(r, c);
            }
        }
        var copy = new int[Rows][];
        for (int r = 0; r < Rows; r++)
        {
            copy[r] = (int[])grid[r].Clone();
        }
        return copy;
    }

    private int Index(int row, int col)
    {
        if (row < 0 || row >= Rows || col < 0 || col >= Cols)
        {
            throw new IndexOutOfRangeException($"cell ({row}, {col}) is outside a {Rows}x{Cols} matrix");
        }
        int index = row * Cols + col;
        if (index >= cells.Length)
        {
            throw new IndexOutOfRangeException($"cell index {index} is out of range");
        }
        return index;
    }
}

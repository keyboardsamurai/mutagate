package pricing
import "testing"
func TestOtherDiscount(t *testing.T) {
 for _, c := range []struct{n, want int}{{9,0},{10,20},{11,20}} {
  if got := Discount(c.n); got != c.want { t.Fatalf("Discount(%d) = %d, want %d", c.n, got, c.want) }
 }
}

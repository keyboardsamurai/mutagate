namespace Acme;
public static class Pricing {
 public static int Discount(int count) {
  if (count >= 10) return 20;
  return 0;
 }
}

package acme;
public class UserService {
  public boolean isEligible(int age) { return age >= 18; }
  public int discountFor(int count) { return count > 10 ? 20 : 0; }
}

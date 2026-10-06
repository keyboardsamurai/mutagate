package acme;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
public class UserServiceTest {
  @Test public void boundaries() {
    UserService s = new UserService();
    assertFalse(s.isEligible(17)); assertTrue(s.isEligible(18)); assertTrue(s.isEligible(19));
    assertEquals(0, s.discountFor(9)); assertEquals(0, s.discountFor(10)); assertEquals(20, s.discountFor(11));
  }
}

package acme;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
public class UserServiceTest {
  @Test public void smoke() { new UserService().isEligible(30); }
}

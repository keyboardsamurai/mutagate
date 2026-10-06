package acme;
import acme.Dependency;
import org.junit.Test;
import static org.junit.Assert.*;
public class UserServiceTest {
  @Test public void smoke() { new UserService().isEligible(30); }
}

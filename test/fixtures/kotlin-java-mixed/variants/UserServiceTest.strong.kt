package acme
import org.junit.Test
import org.junit.Assert.*
class UserServiceTest { @Test fun boundaries() { val s = UserService(); assertFalse(s.isEligible(17)); assertTrue(s.isEligible(18)); assertTrue(s.isEligible(19)); assertEquals(0, s.discountFor(9)); assertEquals(0, s.discountFor(10)); assertEquals(20, s.discountFor(11)) } }

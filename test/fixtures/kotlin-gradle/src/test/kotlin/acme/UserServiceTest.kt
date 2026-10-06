package acme
import org.junit.Test
class UserServiceTest { @Test fun smoke() { UserService().isEligible(30) } }

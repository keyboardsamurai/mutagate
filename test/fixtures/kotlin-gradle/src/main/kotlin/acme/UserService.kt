package acme
class UserService {
  fun isEligible(age: Int): Boolean = age >= 18
  fun discountFor(count: Int): Int = if (count > 10) 20 else 0
}
data class Profile(val name: String, val age: Int = 18)
enum class Level { BASIC, PLUS }
class Constructs {
  lateinit var name: String
  fun greeting(prefix: String = "Hi"): String = prefix + name
  fun level(level: Level): Int = when(level) { Level.BASIC -> 0; Level.PLUS -> 1 }
  suspend fun suspended(n: Int): Int = n + 1
  inline fun increment(n: Int): Int = n + 1
}

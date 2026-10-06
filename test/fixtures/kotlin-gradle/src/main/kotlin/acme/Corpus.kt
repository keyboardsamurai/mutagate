package acme

import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

data class OverrideProfile(val age: Int) {
  override fun equals(other: Any?): Boolean = other is OverrideProfile && age == other.age
  override fun hashCode(): Int = age * 31
  override fun toString(): String = "age=$age"
}

class CoroutineExample {
  private suspend fun step(n: Int): Int = suspendCoroutine { continuation -> continuation.resume(n + 1) }
  suspend fun calculate(n: Int): Int {
    val first = step(n)
    return step(first) * 2
  }
}

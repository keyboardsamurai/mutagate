using Xunit;
namespace Acme.Tests;
public class OtherTests { [Fact] public void Discount() { Assert.Equal(0, Pricing.Discount(9)); Assert.Equal(20, Pricing.Discount(10)); Assert.Equal(20, Pricing.Discount(11)); } }

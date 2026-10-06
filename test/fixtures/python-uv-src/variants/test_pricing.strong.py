from python_uv_src.pricing import discount

def test_discount():
    assert discount(9) == 0
    assert discount(10) == 20
    assert discount(11) == 20

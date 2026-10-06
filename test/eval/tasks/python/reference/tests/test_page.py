from matrix import page, service


def test_renders_numbered_rows_with_sign_classes():
    service.reset(2, 2)
    service.put(0, 0, -3)
    service.put(1, 1, 4)
    assert page.page().body.decode() == (
        "<!DOCTYPE html><html><head><title>Matrix</title></head><body><h1>Matrix 2x2</h1><table>"
        "<tr><th>1</th><td class='negative'>-3</td><td class='zero'>0</td></tr>"
        "<tr><th>2</th><td class='zero'>0</td><td class='positive'>4</td></tr>"
        "</table></body></html>"
    )

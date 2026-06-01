from scripts.validate_publish import main


def test_committed_data_validates():
    assert main() == 0

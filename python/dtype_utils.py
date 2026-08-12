"""
Shared pandas dtype classification for the readers.

All three readers previously decided whether a column was text by testing
`dtype == 'object'`. That was true when pandas represented strings as object
arrays, but current pandas (and the arrays pyreadr/pyreadstat hand back) use a
dedicated string dtype, so the comparison silently fails and every character
column falls through to the numeric branch — wrong icon, wrong reported type,
and no computed length.

Classification is centralised here so the three readers cannot drift apart.
"""

import pandas as pd


def is_text_dtype(dtype) -> bool:
    """True for any dtype holding strings: object, str, string[python], string[pyarrow]."""
    name = str(dtype).lower()
    if name == 'object' or name == 'str' or name.startswith('string'):
        return True
    try:
        # Catches extension dtypes this list does not name explicitly. Callers
        # test numeric first, so object-of-numbers cannot reach here.
        return bool(pd.api.types.is_string_dtype(dtype))
    except Exception:
        return False


def classify_dtype(dtype) -> str:
    """Map a pandas dtype to the variable types the webview understands.

    Order matters: bool and datetime are checked before numeric because both
    satisfy some numeric predicates, and text is checked last.
    """
    try:
        if pd.api.types.is_bool_dtype(dtype):
            return 'logical'
        if pd.api.types.is_datetime64_any_dtype(dtype):
            return 'date'
        if pd.api.types.is_numeric_dtype(dtype):
            return 'numeric'
    except Exception:
        pass

    if is_text_dtype(dtype):
        return 'character'

    # Unknown dtypes are shown as text: values are rendered as-is, whereas
    # calling something numeric invites number formatting that would misrepresent it.
    return 'character'

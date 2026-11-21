"""Uprawnienia modułu AED (django-rules).

Redaktorzy i pełnomocnicy instytucji mogą wyłącznie PRZEGLĄDAĆ raporty i rekordy swojej instytucji
(zawężenie w `get_queryset` adminów). Nikt poza superużytkownikiem nie dodaje ani nie zmienia rekordów
agregatu ręcznie – jedyną drogą danych jest publikacja zbioru przez instytucję.
"""
import rules

from mcod.lib.rules import assigned_to_organization

rules.add_perm("aed", assigned_to_organization)
rules.add_perm("aed.view_aedimportrun", assigned_to_organization)
rules.add_perm("aed.view_aedrecord", assigned_to_organization)

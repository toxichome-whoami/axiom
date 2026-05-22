"""
GraphQL API Layer.

This module provides a hyper-optimized GraphQL endpoint that bypasses traditional
Python row instantiation and serialization. It parses GraphQL into AST and uses
database-native JSON aggregation via SQLGlot to achieve zero-copy responses.
"""

from .router import router

__all__ = ["router"]

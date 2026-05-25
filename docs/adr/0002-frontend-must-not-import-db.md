# ADR 0002: Frontend must not import database layer

## Status
Accepted

## Context
Frontend code should communicate through API or service boundaries.

## Decision
Files under frontend/ or ui/ must not import from backend/db or db directly.

## Consequences
Database access remains centralized in backend services.

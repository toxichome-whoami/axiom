<div align="center">
  <h1>Contributing to Axiom</h1>
  <p><em>Guidelines for collaborating, reporting issues, and submitting code</em></p>
</div>

<hr/>

First off, thank you for considering contributing to Axiom! It's people like you that make Axiom such a great tool.

## 1. Code of Conduct

Help us keep Axiom open and inclusive. Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## 2. Getting Started

- **Fork the Repository**: Create your own copy of the project.
- **Clone Local**: <code>git clone https://github.com/toxichome-whoami/axiom.git </code>
- **Environment**: Use a virtual environment.
  ```bash
  python -m venv .venv
  source .venv/bin/activate  # or .venv\Scripts\activate on Windows
  pip install -r requirements.txt
  ```

## 3. Development Workflow

1. **Create a Branch**: <code>git checkout -b feature/your-feature-name</code>
2. **Implementation**: Follow the strict `src/` layout.
3. **Testing**: Axiom uses `pytest`. Ensure your changes pass all tests.
   ```bash
   pytest tests/
   ```
4. **Linting**: We follow PEP8.
5. **Documentation**: Update the relevant files in `docs/` if you change any public API or configuration.

## 4. Pull Request Process

1. Synchronize your branch with the `main` branch.
2. Write clear, descriptive commit messages.
3. Fill out the Pull Request template completely.
4. A maintainer will review your code and may suggest changes before merging.

## 5. Reporting Bugs

- Use the GitHub Issues tab.
- Describe the expected behavior and the actual behavior.
- Provide a minimal reproduction script if possible.
- Include your `config.toml` (with secrets **REDACTED**).

## 6. Financial Support

If you or your company find Axiom useful, please consider sponsoring the project to ensure its long-term sustainability.

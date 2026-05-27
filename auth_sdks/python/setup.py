from setuptools import find_packages, setup

setup(
    name="axiom-sdk",
    version="1.0.0",
    description="Python SDK for Axiom",
    packages=find_packages(),
    install_requires=[
        "requests>=2.25.1",
    ],
)

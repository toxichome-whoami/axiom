import glob
import os
import sys

from grpc_tools import protoc

PRAGMAS = "# pyright: reportPrivateUsage=false, reportAttributeAccessIssue=false, reportAssignmentType=false, reportUnusedImport=false\n# type: ignore\n# flake8: noqa\n# ruff: noqa\n"


def main():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    proto_src = os.path.join(base_dir, "proto")
    proto_files = glob.glob(os.path.join(proto_src, "axiom", "v1", "*.proto"))
    proto_out = os.path.join(base_dir, "src", "generated")

    if not os.path.exists(proto_out):
        os.makedirs(proto_out)

    # Run protoc
    protoc_args = [
        "grpc_tools.protoc",
        f"-I{proto_src}",
        f"--python_out={proto_out}",
        f"--pyi_out={proto_out}",
        f"--grpc_python_out={proto_out}",
    ] + proto_files

    print(f"Generating protobufs for {len(proto_files)} files...")
    exit_code = protoc.main(protoc_args)

    if exit_code != 0:
        print("Protobuf compilation failed.")
        sys.exit(exit_code)

    # Patch generated files
    for filepath in glob.glob(os.path.join(proto_out, "**", "*"), recursive=True):
        if not (
            filepath.endswith("_pb2.py")
            or filepath.endswith("_pb2_grpc.py")
            or filepath.endswith(".pyi")
        ):
            continue

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        # Remove existing pragmas if re-patching
        if "# pyright:" in content:
            lines = []
            for line in content.splitlines():
                if (
                    line.startswith("# pyright:")
                    or line.startswith("# type: ignore")
                    or line.startswith("# flake8: noqa")
                    or line.startswith("# ruff: noqa")
                ):
                    continue
                lines.append(line)
            content = "\n".join(lines).lstrip()

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(PRAGMAS + content)
        print(f"Patched {os.path.basename(filepath)}")

    print(f"Protobuf code generated and patched successfully in: {proto_out}")


if __name__ == "__main__":
    main()

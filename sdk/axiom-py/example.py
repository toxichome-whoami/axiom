import asyncio

from axiom import Axiom


async def main():
    print("Testing Axiom Python SDK...")
    client = Axiom(
        url="http://localhost:4500", project_id="admin", api_key="admin:secret"
    )

    try:
        tables = await client.db.select("localdb", "sqlite_master")
        print(f"Success! Connected to Axiom and fetched tables: {len(tables)}")
    except Exception as e:
        print(f"Failed to connect: {e}")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())

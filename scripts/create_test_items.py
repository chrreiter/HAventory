#!/usr/bin/env python3
"""Create random test items with all fields populated via HA WebSocket API.

This is a dev/test utility script - security linting rules are relaxed:
- S311: Uses standard random (not crypto) - fine for test data generation
- S603: subprocess call is trusted (pip install)
- PLR2004: Magic numbers are acceptable in test scripts
"""
# ruff: noqa: S311, PLR2004

import asyncio
import os
import random
import sys
from datetime import datetime, timedelta

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import aiohttp
except ImportError:
    print("Installing aiohttp...")
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "aiohttp"])  # noqa: S603
    import aiohttp


# Sample data for random generation
ITEM_NAMES = [
    "Cordless Drill",
    "Hammer",
    "Screwdriver Set",
    "Tape Measure",
    "Level",
    "Wrench Set",
    "Pliers",
    "Saw",
    "Sandpaper",
    "Paint Brush",
    "LED Flashlight",
    "Extension Cord",
    "Utility Knife",
    "Safety Glasses",
    "Work Gloves",
    "Ladder",
    "Toolbox",
    "Drill Bits",
    "Nails (box)",
    "Screws (box)",
    "Duct Tape",
    "WD-40",
    "Super Glue",
    "Zip Ties",
    "Measuring Cup",
    "Garden Hose",
    "Rake",
    "Shovel",
    "Pruning Shears",
    "Wheelbarrow",
    "First Aid Kit",
    "Fire Extinguisher",
    "Smoke Detector",
    "Carbon Monoxide Detector",
    "Flashlight Batteries",
]

DESCRIPTIONS = [
    "Standard household item, well maintained",
    "Professional grade, heavy duty",
    "Compact size, perfect for small spaces",
    "Multi-purpose, versatile tool",
    "Brand new, still in original packaging",
    "Lightly used, excellent condition",
    "Vintage model, collector's item",
    "Battery-powered, includes charger",
    "Ergonomic design, comfortable grip",
    "Weather-resistant, suitable for outdoor use",
]

CATEGORIES = [
    "Tools",
    "Hardware",
    "Safety",
    "Electrical",
    "Plumbing",
    "Garden",
    "Automotive",
    "Cleaning",
    "Storage",
    "Miscellaneous",
]

TAGS = [
    "essential",
    "frequently-used",
    "seasonal",
    "emergency",
    "outdoor",
    "indoor",
    "heavy",
    "fragile",
    "rechargeable",
    "disposable",
    "rental",
    "borrowed",
    "new",
    "vintage",
    "spare",
]

BRANDS = ["DeWalt", "Makita", "Bosch", "Milwaukee", "Stanley", "Craftsman"]


async def create_item_via_ws(session, base_url, token, item_data, msg_id):
    """Create an item via WebSocket API."""
    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://") + "/api/websocket"

    try:
        async with session.ws_connect(ws_url) as ws:
            # Wait for auth_required
            msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
            if msg.get("type") != "auth_required":
                print(f"  Unexpected message: {msg}")
                return None

            # Send auth
            await ws.send_json({"type": "auth", "access_token": token})
            msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
            if msg.get("type") != "auth_ok":
                print(f"  Auth failed: {msg}")
                return None

            # Send create item command
            cmd = {"id": msg_id, "type": "haventory/item/create", **item_data}
            await ws.send_json(cmd)

            # Wait for response
            msg = await asyncio.wait_for(ws.receive_json(), timeout=10)
            if msg.get("success"):
                return msg.get("result")
            else:
                print(f"  Error: {msg.get('error', {}).get('message', 'Unknown error')}")
                return None

    except TimeoutError:
        print("  Timeout waiting for response")
        return None
    except Exception as e:
        print(f"  Exception: {e}")
        return None


def generate_random_item(index):
    """Generate a random item with all fields populated."""
    name = random.choice(ITEM_NAMES)
    name = f"{name} #{index + 1}"

    quantity = random.randint(1, 50)
    low_stock_threshold = random.choice([None, None, 5, 10, 15, 20])
    checked_out = random.random() < 0.2

    due_date = None
    if checked_out:
        days_from_now = random.randint(1, 30)
        due_date = (datetime.now() + timedelta(days=days_from_now)).strftime("%Y-%m-%d")

    num_tags = random.randint(1, 4)
    tags = random.sample(TAGS, num_tags)
    category = random.choice(CATEGORIES)
    description = random.choice(DESCRIPTIONS)

    # Custom fields (mix of different types)
    custom_fields = {}
    if random.random() < 0.7:
        custom_fields["purchase_price"] = round(random.uniform(5.0, 500.0), 2)
    if random.random() < 0.5:
        custom_fields["brand"] = random.choice(BRANDS)
    if random.random() < 0.3:
        custom_fields["warranty_years"] = random.randint(1, 5)
    if random.random() < 0.4:
        custom_fields["serial_number"] = f"SN-{random.randint(100000, 999999)}"

    return {
        "name": name,
        "description": description,
        "quantity": quantity,
        "low_stock_threshold": low_stock_threshold,
        "checked_out": checked_out,
        "due_date": due_date,
        "tags": tags,
        "category": category,
        "custom_fields": custom_fields,
    }


async def main():
    """Run the test item creation script."""
    base_url = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")

    if not token:
        print("Error: HA_TOKEN environment variable not set")
        sys.exit(1)

    print(f"Connecting to Home Assistant at {base_url}")
    print("Creating random items with all bells and whistles...")
    print("-" * 60)

    created = 0
    failed = 0

    start_index = int(os.environ.get("START_INDEX", "0"))
    count = int(os.environ.get("ITEM_COUNT", "30"))

    async with aiohttp.ClientSession() as session:
        for i in range(start_index, start_index + count):
            item_data = generate_random_item(i)
            print(f"[{i + 1:2}/{start_index + count}] Creating: {item_data['name']}")
            print(f"         Category: {item_data['category']}, Tags: {item_data['tags']}")
            print(f"         Qty: {item_data['quantity']}, Low: {item_data['low_stock_threshold']}")
            if item_data["checked_out"]:
                print(f"         CHECKED OUT - Due: {item_data['due_date']}")

            result = await create_item_via_ws(session, base_url, token, item_data, i + 100)

            if result:
                print(f"         ✓ Created with ID: {result.get('id', 'unknown')}")
                created += 1
            else:
                print("         ✗ Failed to create")
                failed += 1

            # Be gentle - wait between requests
            delay = random.uniform(0.5, 1.5)
            print(f"         (waiting {delay:.1f}s...)")
            await asyncio.sleep(delay)
            print()

    print("-" * 60)
    print(f"Done! Created: {created}, Failed: {failed}")


if __name__ == "__main__":
    asyncio.run(main())

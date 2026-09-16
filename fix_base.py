with open('src/db/engines/base.rs', 'r') as f:
    text = f.read()

text = text.replace('pub primary_key: false,', 'pub primary_key: bool,')

# Add derive to ColumnInfo
text = text.replace('pub struct ColumnInfo {', '#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]\npub struct ColumnInfo {')

# Add derive to ForeignKeyInfo
text = text.replace('pub struct ForeignKeyInfo {', '#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]\npub struct ForeignKeyInfo {')

with open('src/db/engines/base.rs', 'w') as f:
    f.write(text)

import os
import glob

def fix_fields(path):
    with open(path, 'r') as f:
        text = f.read()

    # ColumnInfo
    text = text.replace('data_type:', 'r#type:')
    text = text.replace('data_type,', 'r#type: data_type,')
    text = text.replace('is_nullable:', 'nullable:')
    text = text.replace('is_nullable,', 'nullable: is_nullable,')
    
    # Missing primary_key in ColumnInfo? Let's add it as false by default for now
    text = text.replace('nullable:', 'primary_key: false,\n                nullable:')

    # ForeignKeyInfo
    text = text.replace('column_name:', 'column:')
    text = text.replace('column_name,', 'column: column_name,')
    text = text.replace('referenced_table_name:', 'referenced_table:')
    text = text.replace('referenced_table_name,', 'referenced_table: referenced_table_name,')
    text = text.replace('referenced_column_name:', 'referenced_column:')
    text = text.replace('referenced_column_name,', 'referenced_column: referenced_column_name,')

    with open(path, 'w') as f:
        f.write(text)

for file in glob.glob('src/db/engines/*.rs'):
    fix_fields(file)


import re

def update_file(path, describe_impl, fk_impl):
    with open(path, 'r') as f:
        content = f.read()
    
    # Replace describe_table
    content = re.sub(
        r'async fn describe_table\(&self,\s*_table:\s*&str\)\s*->\s*Result<Vec<ColumnInfo>,\s*Box<dyn std::error::Error>>\s*\{\s*Ok\(vec\!\[\]\)\s*\}',
        describe_impl,
        content,
        flags=re.MULTILINE
    )
    
    # Replace get_foreign_keys
    content = re.sub(
        r'async fn get_foreign_keys\(&self,\s*_table:\s*&str\)\s*->\s*Result<Vec<ForeignKeyInfo>,\s*Box<dyn std::error::Error>>\s*\{\s*Ok\(vec\!\[\]\)\s*\}',
        fk_impl,
        content,
        flags=re.MULTILINE
    )
    
    with open(path, 'w') as f:
        f.write(content)


# Postgres
pg_desc = '''async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        let pool = self.pool.as_ref().ok_or("Not connected")?;
        let query_str = "SELECT column_name::text, data_type::text, is_nullable::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name =  ORDER BY ordinal_position";
        let rows = sqlx::query(query_str).bind(table).fetch_all(pool).await?;
        
        let mut columns = Vec::new();
        for row in rows {
            columns.push(ColumnInfo {
                name: row.try_get::<String, _>("column_name").unwrap_or_default(),
                data_type: row.try_get::<String, _>("data_type").unwrap_or_default(),
                is_nullable: row.try_get::<String, _>("is_nullable").unwrap_or("YES".to_string()) == "YES",
            });
        }
        Ok(columns)
    }'''

pg_fk = '''async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        let pool = self.pool.as_ref().ok_or("Not connected")?;
        let query_str = "
            SELECT kcu.column_name::text, ccu.table_name::text AS referenced_table_name, ccu.column_name::text AS referenced_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ";
        let rows = sqlx::query(query_str).bind(table).fetch_all(pool).await?;
        
        let mut fks = Vec::new();
        for row in rows {
            fks.push(ForeignKeyInfo {
                column_name: row.try_get::<String, _>("column_name").unwrap_or_default(),
                referenced_table_name: row.try_get::<String, _>("referenced_table_name").unwrap_or_default(),
                referenced_column_name: row.try_get::<String, _>("referenced_column_name").unwrap_or_default(),
            });
        }
        Ok(fks)
    }'''
update_file('src/db/engines/postgres.rs', pg_desc, pg_fk)

# MySQL
mysql_desc = '''async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        let pool = self.pool.as_ref().ok_or("Not connected")?;
        let query_str = "SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IS_NULLABLE as is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION";
        let rows = sqlx::query(query_str).bind(table).fetch_all(pool).await?;
        
        let mut columns = Vec::new();
        for row in rows {
            columns.push(ColumnInfo {
                name: row.try_get::<String, _>("column_name").unwrap_or_default(),
                data_type: row.try_get::<String, _>("data_type").unwrap_or_default(),
                is_nullable: row.try_get::<String, _>("is_nullable").unwrap_or("YES".to_string()) == "YES",
            });
        }
        Ok(columns)
    }'''

mysql_fk = '''async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        let pool = self.pool.as_ref().ok_or("Not connected")?;
        let query_str = "
            SELECT COLUMN_NAME as column_name, REFERENCED_TABLE_NAME as referenced_table_name, REFERENCED_COLUMN_NAME as referenced_column_name
            FROM information_schema.key_column_usage
            WHERE REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?";
        let rows = sqlx::query(query_str).bind(table).fetch_all(pool).await?;
        
        let mut fks = Vec::new();
        for row in rows {
            fks.push(ForeignKeyInfo {
                column_name: row.try_get::<String, _>("column_name").unwrap_or_default(),
                referenced_table_name: row.try_get::<String, _>("referenced_table_name").unwrap_or_default(),
                referenced_column_name: row.try_get::<String, _>("referenced_column_name").unwrap_or_default(),
            });
        }
        Ok(fks)
    }'''
update_file('src/db/engines/mysql.rs', mysql_desc, mysql_fk)

# MSSQL
mssql_desc = '''async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        let client_arc = self.client.as_ref().ok_or("Not connected")?;
        let mut client = client_arc.lock().await;
        
        let mut query = tiberius::Query::new("SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IS_NULLABLE as is_nullable FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @P1 ORDER BY ORDINAL_POSITION");
        query.bind(table);
        
        let stream = query.query(&mut *client).await?;
        let rows = stream.into_first_result().await?;
        
        let mut columns = Vec::new();
        for row in rows {
            columns.push(ColumnInfo {
                name: row.try_get::<&str, _>("column_name")?.unwrap_or_default().to_string(),
                data_type: row.try_get::<&str, _>("data_type")?.unwrap_or_default().to_string(),
                is_nullable: row.try_get::<&str, _>("is_nullable")?.unwrap_or("YES") == "YES",
            });
        }
        Ok(columns)
    }'''

mssql_fk = '''async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        let client_arc = self.client.as_ref().ok_or("Not connected")?;
        let mut client = client_arc.lock().await;
        
        let mut query = tiberius::Query::new("
            SELECT col1.name as column_name, tab2.name as referenced_table_name, col2.name as referenced_column_name
            FROM sys.foreign_key_columns fkc
            INNER JOIN sys.objects obj ON obj.object_id = fkc.constraint_object_id
            INNER JOIN sys.tables tab1 ON tab1.object_id = fkc.parent_object_id
            INNER JOIN sys.columns col1 ON col1.column_id = parent_column_id AND col1.object_id = tab1.object_id
            INNER JOIN sys.tables tab2 ON tab2.object_id = fkc.referenced_object_id
            INNER JOIN sys.columns col2 ON col2.column_id = referenced_column_id AND col2.object_id = tab2.object_id
            WHERE tab1.name = @P1
        ");
        query.bind(table);
        
        let stream = query.query(&mut *client).await?;
        let rows = stream.into_first_result().await?;
        
        let mut fks = Vec::new();
        for row in rows {
            fks.push(ForeignKeyInfo {
                column_name: row.try_get::<&str, _>("column_name")?.unwrap_or_default().to_string(),
                referenced_table_name: row.try_get::<&str, _>("referenced_table_name")?.unwrap_or_default().to_string(),
                referenced_column_name: row.try_get::<&str, _>("referenced_column_name")?.unwrap_or_default().to_string(),
            });
        }
        Ok(fks)
    }'''
update_file('src/db/engines/mssql.rs', mssql_desc, mssql_fk)

# Libsql
libsql_desc = '''async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        let conn = self.conn.as_ref().ok_or("Not connected")?;
        
        let sql = format!("PRAGMA table_info('{}')", table.replace("'", "''"));
        let mut rows = conn.query(&sql, ()).await?;
        
        let mut columns = Vec::new();
        while let Some(row) = rows.next().await? {
            let name: String = row.get(1)?;
            let data_type: String = row.get(2)?;
            let notnull: i32 = row.get(3)?;
            columns.push(ColumnInfo {
                name,
                data_type,
                is_nullable: notnull == 0,
            });
        }
        Ok(columns)
    }'''

libsql_fk = '''async fn get_foreign_keys(&self, table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        let conn = self.conn.as_ref().ok_or("Not connected")?;
        
        let sql = format!("PRAGMA foreign_key_list('{}')", table.replace("'", "''"));
        let mut rows = conn.query(&sql, ()).await?;
        
        let mut fks = Vec::new();
        while let Some(row) = rows.next().await? {
            let referenced_table_name: String = row.get(2)?;
            let column_name: String = row.get(3)?;
            let referenced_column_name: String = row.get(4)?;
            fks.push(ForeignKeyInfo {
                column_name,
                referenced_table_name,
                referenced_column_name,
            });
        }
        Ok(fks)
    }'''
update_file('src/db/engines/libsql.rs', libsql_desc, libsql_fk)

# ClickHouse
ch_desc = '''async fn describe_table(&self, table: &str) -> Result<Vec<ColumnInfo>, Box<dyn std::error::Error>> {
        let sql = format!("SELECT name as column_name, type as data_type FROM system.columns WHERE database = '{}' AND table = '{}'", self.database, table.replace("'", "''"));
        let result = self.execute(&sql, &[]).await?;
        
        let mut columns = Vec::new();
        if let Some(rows) = result.rows {
            for row in rows {
                let name = row.get("column_name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let data_type = row.get("data_type").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let is_nullable = data_type.starts_with("Nullable");
                columns.push(ColumnInfo {
                    name,
                    data_type,
                    is_nullable,
                });
            }
        }
        Ok(columns)
    }'''

ch_fk = '''async fn get_foreign_keys(&self, _table: &str) -> Result<Vec<ForeignKeyInfo>, Box<dyn std::error::Error>> {
        // ClickHouse does not enforce traditional foreign keys in the same way, return empty.
        Ok(vec![])
    }'''
update_file('src/db/engines/clickhouse.rs', ch_desc, ch_fk)


/*
 * Custom hook for Table column definition state and DDL mutations (Add, Alter, Drop Column).
 * Owned by: ui/pages/table
 * Key deps: react, ../../api/client, ../../types
 */

import { useState, useCallback, useMemo } from 'react';
import { api, DatabaseRecordApi } from '../../api/client';
import { ColumnInfoApi, ForeignKeyInfoApi, TableInfoApi } from '../../types';
import { mapSqlTypeToFormValue } from './format';
import { showAlertDialog } from '../../components/ui/AlertDialog';

export interface UseColumnOperationsProps {
  selectedDb: string;
  selectedTable: string;
  databases: DatabaseRecordApi[];
  schemaCacheRef: React.MutableRefObject<Record<string, { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }>>;
  loadTableData: (options?: { targetCursor?: string | null; reloadSchema?: boolean }) => Promise<void>;
}

export function useColumnOperations({
  selectedDb,
  selectedTable,
  databases,
  schemaCacheRef,
  loadTableData,
}: UseColumnOperationsProps) {
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnInfoApi | null>(null);
  const [isCreatingColumn, setIsCreatingColumn] = useState(false);
  const [createColumnError, setCreateColumnError] = useState<string | null>(null);

  // Column Field Values
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('text');
  const [newColIsArray, setNewColIsArray] = useState(false);
  const [newColDescription, setNewColDescription] = useState('');
  const [newColDefault, setNewColDefault] = useState('NULL');
  const [newColNullable, setNewColNullable] = useState(true);
  const [newColIsUnique, setNewColIsUnique] = useState(false);
  const [newColIsPk, setNewColIsPk] = useState(false);
  const [newColCheck, setNewColCheck] = useState('');
  const [newColIsSensitive, setNewColIsSensitive] = useState(false);

  // Foreign Key on Column
  const [newColFkSchema, setNewColFkSchema] = useState('');
  const [newColFkTable, setNewColFkTable] = useState('');
  const [newColFkColumn, setNewColFkColumn] = useState('');
  const [newColFkOnUpdate, setNewColFkOnUpdate] = useState<'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT'>('NO ACTION');
  const [newColFkOnDelete, setNewColFkOnDelete] = useState<'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT'>('NO ACTION');

  // FK Nested Modal State
  const [isFkModalOpen, setIsFkModalOpen] = useState(false);
  const [draftFkSchema, setDraftFkSchema] = useState('');
  const [draftFkTable, setDraftFkTable] = useState('');
  const [draftFkColumn, setDraftFkColumn] = useState('');
  const [draftFkPairs, setDraftFkPairs] = useState<Array<{ sourceCol: string; targetCol: string }>>([
    { sourceCol: '', targetCol: '' },
  ]);
  const [draftFkOnUpdate, setDraftFkOnUpdate] = useState<'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT'>('NO ACTION');
  const [draftFkOnDelete, setDraftFkOnDelete] = useState<'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT'>('NO ACTION');
  const [isDiscardFkConfirmOpen, setIsDiscardFkConfirmOpen] = useState(false);

  // Snapshot of column values upon opening edit modal (for precise dirty-checking)
  const [initialColumnState, setInitialColumnState] = useState<{
    name: string;
    type: string;
    isArray: boolean;
    description: string;
    defaultValue: string;
    nullable: boolean;
    isUnique: boolean;
    isPk: boolean;
    check: string;
    fkSchema: string;
    fkTable: string;
    fkColumn: string;
    fkOnUpdate: string;
    fkOnDelete: string;
  } | null>(null);

  // Delete column confirmation
  const [deleteColumnTarget, setDeleteColumnTarget] = useState<ColumnInfoApi | null>(null);
  const [isDeletingColumn, setIsDeletingColumn] = useState(false);

  const handleSelectFkTargetTable = useCallback(async (tbl: string, overrideTargetCol?: string) => {
    setDraftFkTable(tbl);
    if (!selectedDb || !tbl) return;
    try {
      if (!schemaCacheRef.current[tbl]) {
        const res = await api.getTableSchema(selectedDb, tbl);
        schemaCacheRef.current[tbl] = {
          columns: res.columns || [],
          foreign_keys: res.foreign_keys || [],
        };
      }
      const targetCols = schemaCacheRef.current[tbl]?.columns || [];
      const pk = targetCols.find((c) => c.primary_key);
      const chosenCol = overrideTargetCol || (pk ? pk.name : targetCols[0]?.name || 'id');
      setDraftFkColumn(chosenCol);
      setDraftFkPairs([{ sourceCol: newColName || '', targetCol: chosenCol }]);
    } catch {
      // Fallback
    }
  }, [selectedDb, newColName, schemaCacheRef]);

  const handleRequestCloseFkModal = useCallback(() => {
    const finalTargetCol = draftFkPairs[0]?.targetCol || draftFkColumn;
    const origTargetCol = newColFkColumn || (newColFkTable ? 'id' : '');
    const hasUnsavedChanges =
      draftFkTable !== newColFkTable ||
      (finalTargetCol !== origTargetCol && (finalTargetCol !== '' || origTargetCol !== '')) ||
      draftFkOnUpdate !== newColFkOnUpdate ||
      draftFkOnDelete !== newColFkOnDelete;

    if (hasUnsavedChanges && (draftFkTable || finalTargetCol)) {
      setIsDiscardFkConfirmOpen(true);
    } else {
      setIsFkModalOpen(false);
    }
  }, [
    draftFkTable,
    draftFkColumn,
    draftFkPairs,
    draftFkOnUpdate,
    draftFkOnDelete,
    newColFkTable,
    newColFkColumn,
    newColFkOnUpdate,
    newColFkOnDelete,
  ]);

  const resetColumnForm = () => {
    setEditingColumn(null);
    setInitialColumnState(null);
    setNewColName('');
    setNewColDescription('');
    setNewColType('text');
    setNewColIsArray(false);
    setNewColDefault('NULL');
    setNewColIsPk(false);
    setNewColNullable(true);
    setNewColIsUnique(false);
    setNewColCheck('');
    setNewColIsSensitive(false);
    setNewColFkSchema('');
    setNewColFkTable('');
    setNewColFkColumn('');
    setDraftFkPairs([{ sourceCol: '', targetCol: '' }]);
    setNewColFkOnUpdate('NO ACTION');
    setNewColFkOnDelete('NO ACTION');
    setCreateColumnError(null);
  };

  const openEditColumn = useCallback((col: ColumnInfoApi, fk?: ForeignKeyInfoApi) => {
    setEditingColumn(col);
    const formType = mapSqlTypeToFormValue(col.type);
    const formNullable = col.nullable ?? true;
    const formDefault = col.default_value ?? '';
    const formPk = !!col.primary_key;
    const formFkTable = fk?.referenced_table || '';
    const formFkColumn = fk?.referenced_column || '';

    setNewColName(col.name);
    setNewColType(formType);
    setNewColIsArray(false);
    setNewColDescription('');
    setNewColDefault(formDefault);
    setNewColNullable(formNullable);
    setNewColIsUnique(false);
    setNewColIsPk(formPk);
    setNewColCheck('');
    setNewColIsSensitive(false);
    setNewColFkSchema('');
    setNewColFkTable(formFkTable);
    setNewColFkColumn(formFkColumn);
    setNewColFkOnUpdate('NO ACTION');
    setNewColFkOnDelete('NO ACTION');

    setDraftFkSchema('');
    setDraftFkTable(formFkTable);
    setDraftFkColumn(formFkColumn);
    setDraftFkPairs([{ sourceCol: col.name, targetCol: formFkColumn || 'id' }]);
    setDraftFkOnUpdate('NO ACTION');
    setDraftFkOnDelete('NO ACTION');

    setInitialColumnState({
      name: col.name,
      type: formType,
      isArray: false,
      description: '',
      defaultValue: formDefault,
      nullable: formNullable,
      isUnique: false,
      isPk: formPk,
      check: '',
      fkSchema: '',
      fkTable: formFkTable,
      fkColumn: formFkColumn,
      fkOnUpdate: 'NO ACTION',
      fkOnDelete: 'NO ACTION',
    });

    setCreateColumnError(null);
    setIsAddColumnOpen(true);
  }, []);

  const openAddColumn = useCallback(() => {
    resetColumnForm();
    setInitialColumnState(null);
    setIsAddColumnOpen(true);
  }, []);

  const hasColumnChanges = useMemo(() => {
    if (!editingColumn || !initialColumnState) {
      return newColName.trim().length > 0;
    }

    const nameChanged = newColName.trim() !== initialColumnState.name;
    const typeChanged = newColType !== initialColumnState.type;
    const isArrayChanged = newColIsArray !== initialColumnState.isArray;
    const descChanged = newColDescription.trim() !== initialColumnState.description;
    const defaultChanged = newColDefault.trim() !== initialColumnState.defaultValue.trim();
    const nullableChanged = newColNullable !== initialColumnState.nullable;
    const uniqueChanged = newColIsUnique !== initialColumnState.isUnique;
    const pkChanged = newColIsPk !== initialColumnState.isPk;
    const checkChanged = newColCheck.trim() !== initialColumnState.check;
    const fkTableChanged = (newColFkTable || '') !== initialColumnState.fkTable;
    const fkColChanged = (newColFkColumn || '') !== initialColumnState.fkColumn;
    const fkOnUpdateChanged = newColFkOnUpdate !== initialColumnState.fkOnUpdate;
    const fkOnDeleteChanged = newColFkOnDelete !== initialColumnState.fkOnDelete;

    return (
      nameChanged ||
      typeChanged ||
      isArrayChanged ||
      descChanged ||
      defaultChanged ||
      nullableChanged ||
      uniqueChanged ||
      pkChanged ||
      checkChanged ||
      fkTableChanged ||
      fkColChanged ||
      fkOnUpdateChanged ||
      fkOnDeleteChanged
    );
  }, [
    editingColumn,
    initialColumnState,
    newColName,
    newColType,
    newColIsArray,
    newColDescription,
    newColDefault,
    newColNullable,
    newColIsUnique,
    newColIsPk,
    newColCheck,
    newColFkTable,
    newColFkColumn,
    newColFkOnUpdate,
    newColFkOnDelete,
  ]);

  const handleSaveColumn = async () => {
    if (!selectedDb || !selectedTable || !newColName.trim()) return;
    const colNameClean = newColName.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!colNameClean) {
      setCreateColumnError('Please enter a valid column name.');
      return;
    }

    setIsCreatingColumn(true);
    setCreateColumnError(null);

    const isEditMode = !!editingColumn;

    try {
      if (isEditMode) {
        const oldCol = editingColumn;
        const currentDb = databases.find((d) => d.alias === selectedDb);
        const engineType = currentDb?.engine?.toLowerCase() || '';

        // 1. Rename column if name has changed
        if (oldCol.name !== colNameClean) {
          let renameSql = '';
          if (engineType.includes('mysql') || engineType.includes('mariadb')) {
            renameSql = `ALTER TABLE \`${selectedTable.replace(/`/g, '``')}\` RENAME COLUMN \`${oldCol.name.replace(/`/g, '``')}\` TO \`${colNameClean.replace(/`/g, '``')}\``;
          } else if (engineType.includes('mssql') || engineType.includes('sqlserver')) {
            renameSql = `EXEC sp_rename '${selectedTable.replace(/'/g, "''")}.${oldCol.name.replace(/'/g, "''")}', '${colNameClean.replace(/'/g, "''")}', 'COLUMN'`;
          } else {
            // PostgreSQL, SQLite, LibSQL
            renameSql = `ALTER TABLE "${selectedTable.replace(/"/g, '""')}" RENAME COLUMN "${oldCol.name.replace(/"/g, '""')}" TO "${colNameClean.replace(/"/g, '""')}"`;
          }
          await api.executeSqlQuery(selectedDb, renameSql);
        }

        // 2. Change column data type if altered
        if (oldCol.type !== newColType) {
          let typeSql = '';
          if (engineType.includes('mysql') || engineType.includes('mariadb')) {
            const nullClause = newColNullable ? 'NULL' : 'NOT NULL';
            typeSql = `ALTER TABLE \`${selectedTable.replace(/`/g, '``')}\` MODIFY COLUMN \`${colNameClean.replace(/`/g, '``')}\` ${newColType} ${nullClause}`;
          } else if (engineType.includes('mssql') || engineType.includes('sqlserver')) {
            const nullClause = newColNullable ? 'NULL' : 'NOT NULL';
            typeSql = `ALTER TABLE [${selectedTable.replace(/]/g, ']]')}] ALTER COLUMN [${colNameClean.replace(/]/g, ']]')}] ${newColType} ${nullClause}`;
          } else if (engineType.includes('postgres') || engineType.includes('postgresql')) {
            typeSql = `ALTER TABLE "${selectedTable.replace(/"/g, '""')}" ALTER COLUMN "${colNameClean.replace(/"/g, '""')}" TYPE ${newColType} USING "${colNameClean.replace(/"/g, '""')}"::${newColType}`;
          }
          if (typeSql) {
            await api.executeSqlQuery(selectedDb, typeSql);
          }
        }

        // 3. Update NULL / NOT NULL constraint if changed
        if (oldCol.nullable !== newColNullable && !(engineType.includes('mysql') || engineType.includes('mssql'))) {
          if (engineType.includes('postgres') || engineType.includes('postgresql')) {
            const nullSql = newColNullable
              ? `ALTER TABLE "${selectedTable.replace(/"/g, '""')}" ALTER COLUMN "${colNameClean.replace(/"/g, '""')}" DROP NOT NULL`
              : `ALTER TABLE "${selectedTable.replace(/"/g, '""')}" ALTER COLUMN "${colNameClean.replace(/"/g, '""')}" SET NOT NULL`;
            await api.executeSqlQuery(selectedDb, nullSql);
          }
        }

        // 4. Update Default Value if changed
        if (newColDefault.trim()) {
          const defTrimmed = newColDefault.trim();
          if (engineType.includes('postgres') || engineType.includes('postgresql')) {
            const defaultSql = defTrimmed.toUpperCase() === 'NULL'
              ? `ALTER TABLE "${selectedTable.replace(/"/g, '""')}" ALTER COLUMN "${colNameClean.replace(/"/g, '""')}" DROP DEFAULT`
              : `ALTER TABLE "${selectedTable.replace(/"/g, '""')}" ALTER COLUMN "${colNameClean.replace(/"/g, '""')}" SET DEFAULT ${defTrimmed}`;
            await api.executeSqlQuery(selectedDb, defaultSql);
          } else if (engineType.includes('mysql') || engineType.includes('mariadb')) {
            const defaultSql = defTrimmed.toUpperCase() === 'NULL'
              ? `ALTER TABLE \`${selectedTable.replace(/`/g, '``')}\` ALTER COLUMN \`${colNameClean.replace(/`/g, '``')}\` DROP DEFAULT`
              : `ALTER TABLE \`${selectedTable.replace(/`/g, '``')}\` ALTER COLUMN \`${colNameClean.replace(/`/g, '``')}\` SET DEFAULT ${defTrimmed}`;
            await api.executeSqlQuery(selectedDb, defaultSql);
          }
        }
      } else {
        // Create new column via standard API endpoint
        const payload = {
          name: colNameClean,
          description: newColDescription.trim() || undefined,
          data_type: newColType,
          is_array: newColIsArray,
          primary_key: newColIsPk,
          unique: newColIsUnique,
          nullable: newColNullable,
          default_value: newColDefault.trim() || undefined,
          check_expression: newColCheck.trim() || undefined,
          foreign_key:
            newColFkTable && newColFkColumn
              ? {
                  schema: newColFkSchema.trim() || undefined,
                  table: newColFkTable.trim(),
                  column: newColFkColumn.trim(),
                  on_update: newColFkOnUpdate !== 'NO ACTION' ? newColFkOnUpdate : undefined,
                  on_delete: newColFkOnDelete !== 'NO ACTION' ? newColFkOnDelete : undefined,
                }
              : undefined,
        };

        await api.createTableColumn(selectedDb, selectedTable, payload);
      }

      setIsAddColumnOpen(false);
      setEditingColumn(null);
      resetColumnForm();

      // Invalidate cache and reload schema + rows
      delete schemaCacheRef.current[selectedTable];
      await loadTableData({ reloadSchema: true });
    } catch (err) {
      setCreateColumnError(err instanceof Error ? err.message : isEditMode ? 'Failed to update column' : 'Failed to create column');
    } finally {
      setIsCreatingColumn(false);
    }
  };

  const handleDeleteColumn = async () => {
    if (!selectedDb || !selectedTable || !deleteColumnTarget) return;
    const colName = deleteColumnTarget.name;
    setIsDeletingColumn(true);
    try {
      const currentDb = databases.find((d) => d.alias === selectedDb);
      const engineType = currentDb?.engine?.toLowerCase() || '';
      let sql = '';
      if (engineType.includes('mysql') || engineType.includes('mariadb')) {
        sql = `ALTER TABLE \`${selectedTable.replace(/`/g, '``')}\` DROP COLUMN \`${colName.replace(/`/g, '``')}\``;
      } else if (engineType.includes('mssql') || engineType.includes('sqlserver')) {
        sql = `ALTER TABLE [${selectedTable.replace(/]/g, ']]')}] DROP COLUMN [${colName.replace(/]/g, ']]')}]`;
      } else {
        sql = `ALTER TABLE "${selectedTable.replace(/"/g, '""')}" DROP COLUMN "${colName.replace(/"/g, '""')}"`;
      }
      await api.executeSqlQuery(selectedDb, sql);

      setDeleteColumnTarget(null);
      setIsAddColumnOpen(false);
      setEditingColumn(null);
      delete schemaCacheRef.current[selectedTable];
      await loadTableData({ reloadSchema: true });
    } catch (err) {
      showAlertDialog(
        err instanceof Error ? err.message : `Failed to drop column ${colName}`,
        'Failed to Drop Column'
      );
    } finally {
      setIsDeletingColumn(false);
    }
  };

  return {
    isAddColumnOpen,
    setIsAddColumnOpen,
    editingColumn,
    setEditingColumn,
    isCreatingColumn,
    createColumnError,
    setCreateColumnError,
    newColName,
    setNewColName,
    newColType,
    setNewColType,
    newColIsArray,
    setNewColIsArray,
    newColDescription,
    setNewColDescription,
    newColDefault,
    setNewColDefault,
    newColNullable,
    setNewColNullable,
    newColIsUnique,
    setNewColIsUnique,
    newColIsPk,
    setNewColIsPk,
    newColCheck,
    setNewColCheck,
    newColIsSensitive,
    setNewColIsSensitive,
    newColFkSchema,
    setNewColFkSchema,
    newColFkTable,
    setNewColFkTable,
    newColFkColumn,
    setNewColFkColumn,
    newColFkOnUpdate,
    setNewColFkOnUpdate,
    newColFkOnDelete,
    setNewColFkOnDelete,
    isFkModalOpen,
    setIsFkModalOpen,
    draftFkSchema,
    setDraftFkSchema,
    draftFkTable,
    setDraftFkTable,
    draftFkColumn,
    setDraftFkColumn,
    draftFkPairs,
    setDraftFkPairs,
    draftFkOnUpdate,
    setDraftFkOnUpdate,
    draftFkOnDelete,
    setDraftFkOnDelete,
    isDiscardFkConfirmOpen,
    setIsDiscardFkConfirmOpen,
    handleSelectFkTargetTable,
    handleRequestCloseFkModal,
    deleteColumnTarget,
    setDeleteColumnTarget,
    isDeletingColumn,
    handleSaveColumn,
    handleDeleteColumn,
    resetColumnForm,
    openEditColumn,
    openAddColumn,
    hasColumnChanges,
  };
}

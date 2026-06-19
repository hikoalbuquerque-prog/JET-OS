package com.jet.os;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

// Fila durável de pontos GPS em SQLite. Sobrevive ao fechamento do app e ao reinício
// do celular — garante que nenhum ponto coletado em segundo plano seja perdido antes
// do upload. O upload (GpsTrackerService) drena esta fila e remove o que foi aceito.
class GpsQueueDb extends SQLiteOpenHelper {
    private static final String DB = "jet_gps_queue.db";
    private static final int VERSION = 1;
    private static final String TABLE = "pontos";

    GpsQueueDb(Context ctx) { super(ctx, DB, null, VERSION); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE + " (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldV, int newV) {
        db.execSQL("DROP TABLE IF EXISTS " + TABLE);
        onCreate(db);
    }

    void enqueue(JSONObject ponto) {
        ContentValues v = new ContentValues();
        v.put("payload", ponto.toString());
        getWritableDatabase().insert(TABLE, null, v);
    }

    // Retorna até `limit` pontos mais antigos (ordem FIFO), com os ids correspondentes.
    Batch peek(int limit) {
        Batch b = new Batch();
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT id, payload FROM " + TABLE + " ORDER BY id ASC LIMIT ?",
                new String[]{ String.valueOf(limit) });
        try {
            while (c.moveToNext()) {
                b.ids.add(c.getLong(0));
                try { b.points.put(new JSONObject(c.getString(1))); } catch (Exception ignore) {}
            }
        } finally { c.close(); }
        return b;
    }

    void delete(List<Long> ids) {
        if (ids.isEmpty()) return;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ids.size(); i++) { if (i > 0) sb.append(','); sb.append(ids.get(i)); }
        getWritableDatabase().execSQL("DELETE FROM " + TABLE + " WHERE id IN (" + sb + ")");
    }

    // Evita crescimento infinito da fila se o backend ficar inacessível por muito tempo:
    // mantém só os `maxRows` pontos mais recentes.
    void trim(int maxRows) {
        getWritableDatabase().execSQL(
                "DELETE FROM " + TABLE + " WHERE id NOT IN (SELECT id FROM " + TABLE +
                " ORDER BY id DESC LIMIT " + maxRows + ")");
    }

    static class Batch {
        List<Long> ids = new ArrayList<>();
        JSONArray points = new JSONArray();
    }
}

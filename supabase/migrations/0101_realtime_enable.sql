-- T1: Enable Supabase Realtime on key operational tables
-- gps_logistica doesn't exist as a table (it's queried from gps points)
ALTER PUBLICATION supabase_realtime ADD TABLE tarefas_logistica;
ALTER PUBLICATION supabase_realtime ADD TABLE slots;

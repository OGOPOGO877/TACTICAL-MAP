Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
bat = folder & "\start.bat"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = folder
sh.Run "cmd.exe /k """ & bat & """", 1, False

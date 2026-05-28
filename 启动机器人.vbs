Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get script's parent folder directory
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.CurrentDirectory = strScriptDir

' 1. Check if node is already running index.js (to prevent duplicate bot instances)
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = 'node.exe'")

Dim isAlreadyRunning
isAlreadyRunning = False
For Each objProcess in colProcesses
    If Not IsNull(objProcess.CommandLine) Then
        strCmd = LCase(objProcess.CommandLine)
        If InStr(strCmd, "src/index.js") > 0 Or InStr(strCmd, "src\index.js") > 0 Then
            isAlreadyRunning = True
            Exit For
        End If
    End If
Next

If isAlreadyRunning Then
    MsgBox "TeleGravity is already running in the background!", 48, "TeleGravity Startup"
    WScript.Quit
End If

' 2. Check if Antigravity is running with CDP enabled on port 9223 using HTTP GET
Dim isPortOpen
isPortOpen = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.open "GET", "http://127.0.0.1:9223/json", False
http.setTimeouts 1000, 1000, 1000, 1000
http.send ""
If Err.Number = 0 Then
    isPortOpen = True
End If
On Error GoTo 0

Dim restartedAntigravity
restartedAntigravity = False

If Not isPortOpen Then
    ' Port 9223 is closed. Terminate any running instances of Antigravity.exe to force restart
    Set colAntiProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = 'Antigravity.exe'")
    For Each objAnti in colAntiProcesses
        objAnti.Terminate()
    Next
    
    ' Launch Antigravity.exe with the debugging port enabled
    strAntiPath = """C:\Users\JackoMA\AppData\Local\Programs\Antigravity\Antigravity.exe"" --remote-debugging-port=9223"
    objShell.Run strAntiPath, 1, False
    restartedAntigravity = True
    WScript.Sleep 3000 ' Wait 3 seconds for Antigravity to startup and bind port
End If

' 3. Start node in background (0: hidden window, False: non-blocking)
strCommand = "cmd.exe /c node src/index.js > bg_out.log 2> bg_err.log"
objShell.Run strCommand, 0, False

Dim msgText
msgText = "TeleGravity has successfully started in the background!" & vbCrLf & _
          "Project Directory: " & strScriptDir & vbCrLf & _
          "Standard log: bg_out.log" & vbCrLf & _
          "Error log: bg_err.log"

If restartedAntigravity Then
    msgText = msgText & vbCrLf & vbCrLf & "Note: Port 9223 was closed, so Antigravity has been restarted with remote debugging enabled!"
End If

MsgBox msgText, 64, "TeleGravity Started"

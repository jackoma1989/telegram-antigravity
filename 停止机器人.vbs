Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = 'node.exe'")

Dim count
count = 0
For Each objProcess in colProcesses
    If Not IsNull(objProcess.CommandLine) Then
        strCmd = LCase(objProcess.CommandLine)
        
        ' Precise filtering logic targeting only TeleGravity bot instances
        If InStr(strCmd, "src/index.js") > 0 Or InStr(strCmd, "src\index.js") > 0 Then
            objProcess.Terminate()
            count = count + 1
        End If
    End If
Next

If count > 0 Then
    MsgBox "Successfully stopped " & count & " TeleGravity process(es)!", 64, "TeleGravity Shutdown"
Else
    MsgBox "No running TeleGravity process found in the background.", 48, "TeleGravity Shutdown"
End If

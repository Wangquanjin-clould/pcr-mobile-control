import com.sailun.pcrmobile.LogixClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Binding audit against the selected simulator; writes are opt-in and same-value only. */
public final class LogixBindingsTest {
    private static String readString(LogixClient client,String tag) {
        int length=((Number)client.read(tag+".LEN","DINT")).intValue();
        if(length<0||length>20)throw new IllegalStateException("STR20 LEN out of range: "+length);
        byte[] data=new byte[length];
        for(int i=0;i<length;i++)data[i]=(byte)((Number)client.read(tag+".DATA["+i+"]","SINT")).intValue();
        return new String(data,StandardCharsets.US_ASCII);
    }
    public static void main(String[] args) throws Exception {
        LogixClient client=new LogixClient();List<String> rows=new ArrayList<>();
        rows.add("channel\ttag\ttype\tresult\tvalue_or_error");int ok=0,failed=0,writes=0;
        try {
            System.out.println(client.connect(args[0],5000));
            for(String row:Files.readAllLines(Path.of(args[1]),StandardCharsets.UTF_8)) {
                if(row.isBlank())continue;
                String[] parts=row.split("\t");String channel=parts[0],type=parts[1],tag=parts[2];
                try {
                    Object value=type.equals("STR20")?readString(client,tag):client.read(tag,type);
                    rows.add(channel+"\t"+tag+"\t"+type+"\tPASS\t"+value);ok++;
                } catch(Exception e) {rows.add(channel+"\t"+tag+"\t"+type+"\tFAIL\t"+e.getMessage());failed++;System.out.println("FAIL "+tag+": "+e.getMessage());}
            }
            if(Arrays.asList(args).contains("--same-value-writes")) {
                for(String channel:new String[]{"1P","3P"}) {
                    String base="HMI_Input_DeviceNo_"+channel+"_1";
                    for(String[] part:new String[][]{{".LEN","DINT"},{".DATA[0]","SINT"}}) {
                        String tag=base+part[0];Object original=client.read(tag,part[1]);
                        try {client.write(tag,part[1],original.toString());writes++;Object value=client.read(tag,part[1]);if(!original.equals(value))throw new IllegalStateException("same-value write readback differs");rows.add(channel+"\t"+tag+"\t"+part[1]+"\tWRITE_PASS\tunchanged="+value);}
                        catch(Exception e) {failed++;rows.add(channel+"\t"+tag+"\t"+part[1]+"\tWRITE_FAIL\t"+e.getMessage());}
                    }
                    int len=((Number)client.read(base+".LEN","DINT")).intValue();byte[] original=new byte[20];
                    for(int i=0;i<20;i++)original[i]=(byte)((Number)client.read(base+".DATA["+i+"]","SINT")).intValue();
                    boolean canRoundTrip=len>=0&&len<=20;
                    for(int i=0;i<20;i++)if((i>=len&&original[i]!=0)||(i<len&&(original[i]<0||original[i]==0)))canRoundTrip=false;
                    if(canRoundTrip) {
                        try {
                            client.writeString(base,new String(original,0,len,StandardCharsets.US_ASCII),20);writes+=2;
                            if(((Number)client.read(base+".LEN","DINT")).intValue()!=len)throw new IllegalStateException("string LEN changed");
                            for(int i=0;i<20;i++)if(((Number)client.read(base+".DATA["+i+"]","SINT")).byteValue()!=original[i])throw new IllegalStateException("string DATA changed");
                            rows.add(channel+"\t"+base+"\tSTR20\tWRITE_PASS\tall 20 bytes and LEN unchanged");
                        } catch(Exception e) {failed++;rows.add(channel+"\t"+base+"\tSTR20\tWRITE_FAIL\t"+e.getMessage());}
                    } else rows.add(channel+"\t"+base+"\tSTR20\tWRITE_SKIPPED\tunused DATA or non-ASCII bytes retained");
                }
            }
        } finally {client.disconnect();Files.write(Path.of(args[2]),rows,StandardCharsets.UTF_8);}
        System.out.println("BINDINGS: reads passed="+ok+", failures="+failed+", same-value write requests="+writes);
        System.out.println("No start, stop, reset, manual-mode or jog command was written.");
        if(failed!=0)System.exit(3);
    }
}

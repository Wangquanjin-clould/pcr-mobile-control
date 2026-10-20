import com.sailun.pcrmobile.LogixClient;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Query inputs only. Requires idle command bits and zero-filled empty query inputs. */
public final class LogixQueryTest {
    public static void main(String[] args) throws Exception {
        LogixClient c=new LogixClient(); List<String> log=new ArrayList<>();
        List<String> changed=new ArrayList<>();
        try {
            log.add(c.connect(args[0],5000));
            for(String ch:new String[]{"1P","3P"}) {
                for(String t:new String[]{"HMI_Manual_","HMI_Manaul_AC_Fwd_","HMI_Manaul_AC_Rev_","HMI_Manaul_BD_Fwd_","HMI_Manaul_BD_Rev_","HMI_Manaul_Up_","HMI_Manaul_Dn_","HMI_PalletData_Chg_","HMI_PalletData_Clr_"})
                    if(Boolean.TRUE.equals(c.read(t+ch,"BOOL")))throw new IllegalStateException("Query test skipped: active command "+t+ch);
                String base="HMI_Input_DeviceNo_"+ch+"_1";
                if(((Number)c.read(base+".LEN","DINT")).intValue()!=0)throw new IllegalStateException("Query input is occupied: "+base);
                for(int i=0;i<20;i++)if(((Number)c.read(base+".DATA["+i+"]","SINT")).intValue()!=0)throw new IllegalStateException("Query input has retained bytes: "+base);
            }
            for(String[] test:new String[][]{{"1P","P1025","101025"},{"3P","P1004","101004"}}) {
                String ch=test[0],base="HMI_Input_DeviceNo_"+ch+"_1";
                changed.add(base); c.writeString(base,test[1],20);
                Thread.sleep(1200);
                Object selected=c.read("AOI_HMI_ID_CHOOSE_"+ch+".HMI_Man_No1","DINT");
                Object length=c.read("HMI_DISPLAY_DeviceNo_"+ch+"_1.LEN","DINT");
                log.add(ch+" input="+test[1]+", expected="+test[2]+", selected="+selected+", display LEN="+length+", result="+(selected.toString().equals(test[2])?"PASS":"FAIL"));
            }
        } finally {
            for(String base:changed) {
                c.writeString(base,"",20);
                boolean restored=((Number)c.read(base+".LEN","DINT")).intValue()==0;
                for(int i=0;i<20;i++)restored &= ((Number)c.read(base+".DATA["+i+"]","SINT")).intValue()==0;
                log.add("RESTORE "+base+": "+(restored?"PASS":"FAIL"));
            }
            c.disconnect(); Files.write(Path.of(args[1]),log,StandardCharsets.UTF_8);
            for(String line:log)System.out.println(line);
        }
    }
}

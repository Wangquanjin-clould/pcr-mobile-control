import com.sailun.pcrmobile.LogixClient;
import java.io.*;
import java.lang.reflect.*;
import java.net.Socket;
import java.nio.*;
import java.util.*;

/** Runs the production Kotlin client against independent wire-format fixtures. */
public final class LogixCommunicationTest {
    private static int passed;
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
        passed++;
    }
    private static byte[] hex(String value) {
        return HexFormat.of().parseHex(value.replace(" ", ""));
    }
    private static void same(byte[] expected, byte[] actual, String label) {
        check(Arrays.equals(expected, actual), label + "\nexpected=" + HexFormat.of().formatHex(expected) + "\nactual=" + HexFormat.of().formatHex(actual));
    }
    private static void field(LogixClient client, String name, Object value) throws Exception {
        Field f=LogixClient.class.getDeclaredField(name);f.setAccessible(true);f.set(client,value);
    }
    private static byte[] path(LogixClient client, String value) throws Exception {
        Method method=LogixClient.class.getDeclaredMethod("path",String.class);method.setAccessible(true);
        return (byte[])method.invoke(client,value);
    }
    private static byte[] reply(byte[] cip) {
        ByteBuffer buffer=ByteBuffer.allocate(40+cip.length).order(ByteOrder.LITTLE_ENDIAN);
        buffer.putShort((short)0x6f).putShort((short)(16+cip.length)).putInt(1).putInt(0).putLong(1).putInt(0);
        buffer.putInt(0).putShort((short)0).putShort((short)2).putShort((short)0).putShort((short)0);
        buffer.putShort((short)0xb2).putShort((short)cip.length).put(cip);
        return buffer.array();
    }
    private static ByteArrayOutputStream prepare(LogixClient client, byte[]... replies) throws Exception {
        ByteArrayOutputStream input=new ByteArrayOutputStream();for(byte[] part:replies)input.write(part);
        ByteArrayOutputStream captured=new ByteArrayOutputStream();
        field(client,"socket",new Socket());field(client,"session",1);
        field(client,"input",new BufferedInputStream(new ByteArrayInputStream(input.toByteArray())));
        field(client,"output",new BufferedOutputStream(captured));return captured;
    }
    private static List<byte[]> requests(byte[] bytes) {
        List<byte[]> out=new ArrayList<>();int offset=0;
        while(offset<bytes.length) {
            int len=Short.toUnsignedInt(ByteBuffer.wrap(bytes,offset+2,2).order(ByteOrder.LITTLE_ENDIAN).getShort());
            out.add(Arrays.copyOfRange(bytes,offset+40,offset+24+len));offset+=24+len;
        }
        return out;
    }
    private static void offline() throws Exception {
        LogixClient client=new LogixClient();
        same(hex("04 91014100 91014200"),path(client,"A.B"),"structure member separator");
        same(hex("06 91014100 2801 2819 91014200"),path(client,"A[1,25].B"),"multidimensional array and member");
        same(hex("03 91014100 28ff"),path(client,"A[255]"),"8-bit index boundary");
        same(hex("04 91014100 2900 0001"),path(client,"A[256]"),"16-bit index padding");
        same(hex("05 91014100 2a00 00000100"),path(client,"A[65536]"),"32-bit index padding");
        for(String invalid:new String[]{"A.",".A","A..B","A[-1]","A[x]","A[1,]",""}) {
            try {path(client,invalid);throw new AssertionError("accepted invalid path "+invalid);}
            catch(InvocationTargetException e) {check(e.getCause() instanceof IllegalArgumentException,"reject invalid path "+invalid);}
        }
        ByteArrayOutputStream capture=prepare(client,reply(hex("cd000000")));
        client.write("Flag","BOOL","1");
        same(hex("4d03 9104466c6167 c100 0100 01"),requests(capture.toByteArray()).get(0),"write BOOL: type before count");
        capture=prepare(client,reply(hex("cd000000")),reply(hex("cd000000")));
        client.writeString("Input","P1004",20);
        List<byte[]> stringRequests=requests(capture.toByteArray());
        check(stringRequests.size()==2,"string LEN and DATA requests");
        byte[] len=stringRequests.get(0),data=stringRequests.get(1);
        int lenData=2+2*Byte.toUnsignedInt(len[1]),dataStart=2+2*Byte.toUnsignedInt(data[1]);
        same(hex("c400 0100 05000000"),Arrays.copyOfRange(len,lenData,len.length),"string LEN data type/count/value");
        same(hex("c200 1400"),Arrays.copyOfRange(data,dataStart,dataStart+4),"string DATA type/count");
        same("P1004".getBytes(java.nio.charset.StandardCharsets.US_ASCII),Arrays.copyOfRange(data,dataStart+4,dataStart+9),"string ASCII content");
        check(data.length-dataStart-4==20,"string DATA fixed length");
        capture=prepare(client,reply(hex("cc000000 c300 0005")));
        check(client.read("SCADA_P[1,25].DeviceStatus","INT").equals(1280),"read INT status word");
        byte[] read=requests(capture.toByteArray()).get(0);
        same(hex("4c0e 910753434144415f5000 2801 2819 910c446576696365537461747573 0100"),read,"read full SCADA member request");
        prepare(client,reply(hex("cc000501 0421")));
        try {client.read("NotFound","INT");throw new AssertionError("accepted CIP error");}
        catch(IllegalStateException e) {check(e.getMessage().contains("0x5")&&e.getMessage().contains("04 21"),"CIP error and extended status surfaced");}
        client.disconnect();System.out.println("PASS: "+passed+" protocol assertions; no packets sent to the PLC.");
    }
    private static int live(String host) {
        LogixClient client=new LogixClient();
        String[][] tags={{"HMI_Manual_1P","BOOL"},{"HMI_Manual_3P","BOOL"},{"HMI_Input_DeviceNo_1P_1.LEN","DINT"},{"HMI_Input_DeviceNo_3P_1.LEN","DINT"},{"SCADA_P[1,4].DeviceStatus","INT"},{"SCADA_Z5[23].DeviceStatus","INT"}};
        try {
            System.out.println(client.connect(host,5000));
            int failures=0;
            for(String[] tag:tags) {
                try {System.out.println("READ "+tag[0]+" = "+client.read(tag[0],tag[1]));}
                catch(Exception e) {failures++;System.out.println("READ FAILED "+tag[0]+": "+e.getMessage());}
            }
            return failures==0?0:3;
        } catch(Exception e) {System.err.println("CONNECTION FAILED "+host+":44818: "+e);return 2;}
        finally {client.disconnect();}
    }
    public static void main(String[] args) throws Exception {offline();if(args.length>0)System.exit(live(args[0]));}
}
